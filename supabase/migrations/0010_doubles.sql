-- 0010_doubles.sql
-- 2v2 doubles, ranked by TEAM. A team is a pair of players: it's created
-- automatically the first time the pair records a match, and has its own
-- Glicko-2 rating, separate from both players' singles ratings (Ana & Ben and
-- Ana & Cris are different teams). Matches follow the singles flow: the
-- submitter's team records it as pending; one of the two opponents confirms it
-- (team ratings change then) or declines it.
--
-- As with singles, clients can only read these tables. Writes go through the
-- RPCs below, called by the submit-doubles-match / confirm-doubles-match Edge
-- Functions with the service role.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.teams (
  id              uuid primary key default gen_random_uuid(),
  -- The two players, stored in a fixed order so a pair is always one team.
  player_low      uuid not null references public.players (id) on delete cascade,
  player_high     uuid not null references public.players (id) on delete cascade,
  rating          double precision not null default 1500,
  rd              double precision not null default 350,
  volatility      double precision not null default 0.06,
  matches_played  integer not null default 0,
  last_played_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint team_pair_ordered check (player_low < player_high),
  unique (player_low, player_high)
);

create table public.doubles_matches (
  id            uuid primary key default gen_random_uuid(),
  team_a        uuid not null references public.teams (id) on delete cascade,  -- the submitter's team
  team_b        uuid not null references public.teams (id) on delete cascade,
  winner_team   uuid not null references public.teams (id) on delete cascade,
  games_played  integer not null check (games_played between 1 and 21),
  played_at     timestamptz not null default now(),
  created_by    uuid not null references public.players (id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending', 'confirmed', 'rejected')),
  confirmed_by  uuid references public.players (id) on delete set null,
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now(),
  constraint doubles_teams_differ check (team_a <> team_b),
  constraint doubles_winner_is_a_team check (winner_team in (team_a, team_b))
);

-- Per-game scores; score_a is team_a's (the submitter's team).
create table public.doubles_games (
  id        uuid primary key default gen_random_uuid(),
  match_id  uuid not null references public.doubles_matches (id) on delete cascade,
  game_no   integer not null,
  score_a   integer not null check (score_a >= 0),
  score_b   integer not null check (score_b >= 0),
  unique (match_id, game_no)
);

-- Append-only audit: one row per team per confirmed match.
create table public.team_rating_events (
  id                 uuid primary key default gen_random_uuid(),
  match_id           uuid not null references public.doubles_matches (id) on delete cascade,
  team_id            uuid not null references public.teams (id) on delete cascade,
  opponent_team_id   uuid not null references public.teams (id) on delete cascade,
  result             text not null check (result in ('win', 'loss')),
  rating_before      double precision not null,
  rd_before          double precision not null,
  volatility_before  double precision not null,
  rating_after       double precision not null,
  rd_after           double precision not null,
  volatility_after   double precision not null,
  delta              double precision not null,
  repeat_factor      double precision not null default 1,
  created_at         timestamptz not null default now()
);

create index teams_player_low_idx on public.teams (player_low);
create index teams_player_high_idx on public.teams (player_high);
create index doubles_matches_pending_idx on public.doubles_matches (status) where status = 'pending';
create index doubles_matches_teams_played_idx on public.doubles_matches (team_a, team_b, played_at desc);
create index team_rating_events_team_idx on public.team_rating_events (team_id, created_at desc);

-- Win/loss per team, counted in the database (like player_records). Runs with
-- the caller's rights, so team_rating_events' RLS applies.
create view public.team_records
with (security_invoker = on) as
select team_id,
       (count(*) filter (where result = 'win'))::int  as wins,
       (count(*) filter (where result = 'loss'))::int as losses
from public.team_rating_events
group by team_id;

-- ---------------------------------------------------------------------------
-- Row-Level Security: read-only for signed-in users; no client writes.
-- ---------------------------------------------------------------------------

alter table public.teams              enable row level security;
alter table public.doubles_matches    enable row level security;
alter table public.doubles_games      enable row level security;
alter table public.team_rating_events enable row level security;

create policy "teams readable by authenticated"
  on public.teams for select to authenticated using (true);
create policy "doubles_matches readable by authenticated"
  on public.doubles_matches for select to authenticated using (true);
create policy "doubles_games readable by authenticated"
  on public.doubles_games for select to authenticated using (true);
create policy "team_rating_events readable by authenticated"
  on public.team_rating_events for select to authenticated using (true);

-- Explicit grants rather than Supabase's defaults (which from 2026-10-30 no
-- longer expose new tables to the Data API): read-only for signed-in users and
-- the Edge Functions, nothing for anonymous visitors.
revoke all on public.teams, public.doubles_matches, public.doubles_games,
              public.team_rating_events, public.team_records
  from anon, authenticated;
grant select on public.teams, public.doubles_matches, public.doubles_games,
                public.team_rating_events, public.team_records
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- team_for_pair: the team for two players, created on first use.
-- ---------------------------------------------------------------------------

create or replace function public.team_for_pair(p1 uuid, p2 uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  lo  uuid := least(p1, p2);
  hi  uuid := greatest(p1, p2);
  tid uuid;
begin
  if p1 is null or p2 is null or p1 = p2 then
    raise exception 'A team needs two different players';
  end if;
  insert into public.teams (player_low, player_high) values (lo, hi)
  on conflict (player_low, player_high) do nothing;
  select id into tid from public.teams where player_low = lo and player_high = hi;
  return tid;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_pending_doubles_match: store the match + games (no rating change yet).
-- payload.match: created_by, partner, opponent_1, opponent_2,
--                winner ('a' = the submitter's team), games_played, played_at
-- ---------------------------------------------------------------------------

create or replace function public.create_pending_doubles_match(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  m         jsonb := payload -> 'match';
  me        uuid := (m ->> 'created_by')::uuid;
  partner   uuid := (m ->> 'partner')::uuid;
  opp1      uuid := (m ->> 'opponent_1')::uuid;
  opp2      uuid := (m ->> 'opponent_2')::uuid;
  ta        uuid;
  tb        uuid;
  new_match uuid;
  game      jsonb;
begin
  if (select count(distinct p) from unnest(array[me, partner, opp1, opp2]) as p) <> 4 then
    raise exception 'A doubles match needs four different players';
  end if;

  ta := public.team_for_pair(me, partner);
  tb := public.team_for_pair(opp1, opp2);

  insert into public.doubles_matches (team_a, team_b, winner_team, games_played, played_at, created_by)
  values (
    ta,
    tb,
    case when m ->> 'winner' = 'a' then ta else tb end,
    (m ->> 'games_played')::int,
    coalesce((m ->> 'played_at')::timestamptz, now()),
    me
  )
  returning id into new_match;

  for game in select * from jsonb_array_elements(payload -> 'games')
  loop
    insert into public.doubles_games (match_id, game_no, score_a, score_b)
    values (new_match, (game ->> 'game_no')::int, (game ->> 'score_a')::int, (game ->> 'score_b')::int);
  end loop;

  return new_match;
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_doubles_match: mark a pending match confirmed and apply the team
-- rating update (events + teams) atomically. Guards against double-confirming.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_doubles_match(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  mid      uuid := (payload ->> 'match_id')::uuid;
  ev       jsonb;
  tr       jsonb;
  updated  int;
begin
  update public.doubles_matches
     set status = 'confirmed', confirmed_at = now(), confirmed_by = (payload ->> 'confirmed_by')::uuid
   where id = mid and status = 'pending';
  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'Match % is not pending', mid;
  end if;

  for ev in select * from jsonb_array_elements(payload -> 'events')
  loop
    insert into public.team_rating_events (
      match_id, team_id, opponent_team_id, result,
      rating_before, rd_before, volatility_before,
      rating_after, rd_after, volatility_after,
      delta, repeat_factor)
    values (
      mid,
      (ev ->> 'team_id')::uuid,
      (ev ->> 'opponent_team_id')::uuid,
      ev ->> 'result',
      (ev ->> 'rating_before')::float8,
      (ev ->> 'rd_before')::float8,
      (ev ->> 'volatility_before')::float8,
      (ev ->> 'rating_after')::float8,
      (ev ->> 'rd_after')::float8,
      (ev ->> 'volatility_after')::float8,
      (ev ->> 'delta')::float8,
      coalesce((ev ->> 'repeat_factor')::float8, 1));
  end loop;

  for tr in select * from jsonb_array_elements(payload -> 'ratings')
  loop
    update public.teams
       set rating         = (tr ->> 'rating')::float8,
           rd             = (tr ->> 'rd')::float8,
           volatility     = (tr ->> 'volatility')::float8,
           matches_played = matches_played + 1,
           last_played_at = coalesce((tr ->> 'played_at')::timestamptz, now()),
           updated_at     = now()
     where id = (tr ->> 'team_id')::uuid;
  end loop;

  return mid;
end;
$$;

-- ---------------------------------------------------------------------------
-- reject_doubles_match: an opponent declines a pending match.
-- ---------------------------------------------------------------------------

create or replace function public.reject_doubles_match(match_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated int;
begin
  update public.doubles_matches set status = 'rejected' where id = match_id and status = 'pending';
  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

revoke all on function public.team_for_pair(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_pending_doubles_match(jsonb) from public, anon, authenticated;
revoke all on function public.confirm_doubles_match(jsonb) from public, anon, authenticated;
revoke all on function public.reject_doubles_match(uuid) from public, anon, authenticated;
grant execute on function public.create_pending_doubles_match(jsonb) to service_role;
grant execute on function public.confirm_doubles_match(jsonb) to service_role;
grant execute on function public.reject_doubles_match(uuid) to service_role;
