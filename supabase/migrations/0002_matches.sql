-- 0002_matches.sql
-- Phase 2: matches, per-game scores, append-only rating audit, and the atomic
-- persistence RPC used by the `submit-match` Edge Function.
--
-- Clients cannot write any of these tables (no insert/update policy). All writes
-- go through `apply_rated_match`, executed by the Edge Function with the service
-- role, so ratings can never be forged or desynced from matches.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.matches (
  id            uuid primary key default gen_random_uuid(),
  context       text not null default 'casual' check (context in ('casual', 'tournament')),
  tournament_id uuid,                 -- FK added in the Phase 4 tournaments migration
  round         integer,
  player_a      uuid not null references public.players (id) on delete cascade,
  player_b      uuid not null references public.players (id) on delete cascade,
  winner_id     uuid not null references public.players (id),
  best_of       integer not null default 3 check (best_of in (1, 3, 5, 7)),
  played_at     timestamptz not null default now(),
  created_by    uuid not null references public.players (id),
  created_at    timestamptz not null default now(),
  constraint players_differ check (player_a <> player_b),
  constraint winner_is_participant check (winner_id in (player_a, player_b))
);

create table public.match_games (
  id       uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  game_no  integer not null,
  score_a  integer not null check (score_a >= 0),
  score_b  integer not null check (score_b >= 0),
  unique (match_id, game_no)
);

-- Append-only audit: one row per player per match ("show your work").
create table public.rating_events (
  id                 uuid primary key default gen_random_uuid(),
  match_id           uuid not null references public.matches (id) on delete cascade,
  player_id          uuid not null references public.players (id) on delete cascade,
  opponent_id        uuid not null references public.players (id) on delete cascade,
  result             text not null check (result in ('win', 'loss')),
  rating_before      double precision not null,
  rd_before          double precision not null,
  volatility_before  double precision not null,
  rating_after       double precision not null,
  rd_after           double precision not null,
  volatility_after   double precision not null,
  delta              double precision not null,
  repeat_factor      double precision not null default 1,
  provisional        boolean not null default false,
  created_at         timestamptz not null default now()
);

create index matches_pair_played_idx on public.matches (player_a, player_b, played_at desc);
create index matches_player_a_idx on public.matches (player_a, played_at desc);
create index matches_player_b_idx on public.matches (player_b, played_at desc);
create index rating_events_player_idx on public.rating_events (player_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row-Level Security: read-only for authenticated users; no client writes.
-- ---------------------------------------------------------------------------

alter table public.matches       enable row level security;
alter table public.match_games   enable row level security;
alter table public.rating_events enable row level security;

create policy "matches readable by authenticated"
  on public.matches for select to authenticated using (true);
create policy "match_games readable by authenticated"
  on public.match_games for select to authenticated using (true);
create policy "rating_events readable by authenticated"
  on public.rating_events for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Atomic persistence. The Edge Function computes ratings (in tested TS) and
-- calls this to write everything in one transaction. `security definer` so it
-- may write the RLS-protected tables; execute is restricted to service_role.
-- ---------------------------------------------------------------------------

create or replace function public.apply_rated_match(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  m           jsonb := payload -> 'match';
  new_match   uuid;
  game        jsonb;
  event       jsonb;
  rating_row  jsonb;
begin
  insert into public.matches (context, tournament_id, round, player_a, player_b,
                              winner_id, best_of, played_at, created_by)
  values (
    coalesce(m ->> 'context', 'casual'),
    nullif(m ->> 'tournament_id', '')::uuid,
    nullif(m ->> 'round', '')::int,
    (m ->> 'player_a')::uuid,
    (m ->> 'player_b')::uuid,
    (m ->> 'winner_id')::uuid,
    coalesce((m ->> 'best_of')::int, 3),
    coalesce((m ->> 'played_at')::timestamptz, now()),
    (m ->> 'created_by')::uuid
  )
  returning id into new_match;

  for game in select * from jsonb_array_elements(payload -> 'games')
  loop
    insert into public.match_games (match_id, game_no, score_a, score_b)
    values (new_match, (game ->> 'game_no')::int,
            (game ->> 'score_a')::int, (game ->> 'score_b')::int);
  end loop;

  for event in select * from jsonb_array_elements(payload -> 'events')
  loop
    insert into public.rating_events (
      match_id, player_id, opponent_id, result,
      rating_before, rd_before, volatility_before,
      rating_after, rd_after, volatility_after,
      delta, repeat_factor, provisional)
    values (
      new_match,
      (event ->> 'player_id')::uuid,
      (event ->> 'opponent_id')::uuid,
      event ->> 'result',
      (event ->> 'rating_before')::float8,
      (event ->> 'rd_before')::float8,
      (event ->> 'volatility_before')::float8,
      (event ->> 'rating_after')::float8,
      (event ->> 'rd_after')::float8,
      (event ->> 'volatility_after')::float8,
      (event ->> 'delta')::float8,
      coalesce((event ->> 'repeat_factor')::float8, 1),
      coalesce((event ->> 'provisional')::boolean, false));
  end loop;

  for rating_row in select * from jsonb_array_elements(payload -> 'ratings')
  loop
    update public.player_ratings
       set rating         = (rating_row ->> 'rating')::float8,
           rd             = (rating_row ->> 'rd')::float8,
           volatility     = (rating_row ->> 'volatility')::float8,
           matches_played = matches_played + 1,
           last_played_at = coalesce((rating_row ->> 'played_at')::timestamptz, now()),
           updated_at     = now()
     where player_id = (rating_row ->> 'player_id')::uuid;
  end loop;

  return new_match;
end;
$$;

revoke all on function public.apply_rated_match(jsonb) from public, anon, authenticated;
grant execute on function public.apply_rated_match(jsonb) to service_role;
