-- 0003_tournaments.sql
-- Phase 4: single-elimination tournaments whose matches feed the SAME rating
-- engine as casual play (context = 'tournament').
--
-- As with matches, clients cannot write these tables. Creation and result
-- recording go through the create_tournament / apply_tournament_result RPCs,
-- called by Edge Functions with the service role.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.tournaments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  format      text not null default 'single_elim'
              check (format in ('single_elim', 'round_robin', 'double_elim', 'groups_knockout')),
  tier        integer not null default 1,          -- weight for season points (Phase 5)
  best_of     integer not null default 3 check (best_of in (1, 3, 5, 7)),
  size        integer not null,                     -- bracket size (power of two)
  status      text not null default 'active' check (status in ('draft', 'active', 'completed')),
  created_by  uuid not null references public.players (id),
  start_date  timestamptz not null default now(),
  end_date    timestamptz,
  created_at  timestamptz not null default now()
);

create table public.tournament_participants (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  player_id     uuid not null references public.players (id) on delete cascade,
  seed          integer not null,
  unique (tournament_id, player_id)
);

-- One row per bracket node (match slot), created up front for the whole bracket.
create table public.tournament_matches (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round         integer not null,   -- 1 = first round, increasing toward the final
  slot          integer not null,   -- 0-based position within the round
  player_a      uuid references public.players (id),
  player_b      uuid references public.players (id),
  winner_id     uuid references public.players (id),
  match_id      uuid references public.matches (id),  -- the rated match, once played
  status        text not null default 'pending' check (status in ('pending', 'ready', 'completed')),
  unique (tournament_id, round, slot)
);

-- Now that tournaments exists, connect matches recorded in a tournament to it.
alter table public.matches
  add constraint matches_tournament_fk
  foreign key (tournament_id) references public.tournaments (id) on delete set null;

create index tournament_participants_tid_idx on public.tournament_participants (tournament_id);
create index tournament_matches_tid_idx on public.tournament_matches (tournament_id, round, slot);

-- ---------------------------------------------------------------------------
-- Row-Level Security: read-only for authenticated users; no client writes.
-- ---------------------------------------------------------------------------

alter table public.tournaments            enable row level security;
alter table public.tournament_participants enable row level security;
alter table public.tournament_matches      enable row level security;

create policy "tournaments readable by authenticated"
  on public.tournaments for select to authenticated using (true);
create policy "tournament_participants readable by authenticated"
  on public.tournament_participants for select to authenticated using (true);
create policy "tournament_matches readable by authenticated"
  on public.tournament_matches for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- create_tournament: insert tournament + participants + bracket nodes atomically.
-- The bracket itself is generated in the Edge Function (tested TS) and passed in.
-- ---------------------------------------------------------------------------

create or replace function public.create_tournament(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t         jsonb := payload -> 'tournament';
  new_id    uuid;
  part      jsonb;
  node      jsonb;
begin
  insert into public.tournaments (name, format, tier, best_of, size, created_by)
  values (
    t ->> 'name',
    coalesce(t ->> 'format', 'single_elim'),
    coalesce((t ->> 'tier')::int, 1),
    coalesce((t ->> 'best_of')::int, 3),
    (t ->> 'size')::int,
    (t ->> 'created_by')::uuid
  )
  returning id into new_id;

  for part in select * from jsonb_array_elements(payload -> 'participants')
  loop
    insert into public.tournament_participants (tournament_id, player_id, seed)
    values (new_id, (part ->> 'player_id')::uuid, (part ->> 'seed')::int);
  end loop;

  for node in select * from jsonb_array_elements(payload -> 'nodes')
  loop
    insert into public.tournament_matches (tournament_id, round, slot, player_a, player_b, winner_id, status)
    values (
      new_id,
      (node ->> 'round')::int,
      (node ->> 'slot')::int,
      nullif(node ->> 'player_a', '')::uuid,
      nullif(node ->> 'player_b', '')::uuid,
      nullif(node ->> 'winner_id', '')::uuid,
      coalesce(node ->> 'status', 'pending')
    );
  end loop;

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_tournament_result: persist the rated match (reusing apply_rated_match),
-- complete this bracket node, and advance the winner to the parent slot (or
-- finish the tournament if this was the final).
-- ---------------------------------------------------------------------------

create or replace function public.apply_tournament_result(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_match     uuid;
  tm_id         uuid := (payload ->> 'tournament_match_id')::uuid;
  winner        uuid := (payload -> 'match' ->> 'winner_id')::uuid;
  total_rounds  int  := (payload ->> 'total_rounds')::int;
  v_round       int;
  v_slot        int;
  v_tid         uuid;
  parent_slot   int;
begin
  -- Insert match + games + rating_events + updated ratings (shared logic).
  new_match := public.apply_rated_match(payload);

  update public.tournament_matches
     set match_id = new_match, winner_id = winner, status = 'completed'
   where id = tm_id
   returning round, slot, tournament_id into v_round, v_slot, v_tid;

  if v_round < total_rounds then
    parent_slot := v_slot / 2;   -- integer division
    if v_slot % 2 = 0 then
      update public.tournament_matches set player_a = winner
       where tournament_id = v_tid and round = v_round + 1 and slot = parent_slot;
    else
      update public.tournament_matches set player_b = winner
       where tournament_id = v_tid and round = v_round + 1 and slot = parent_slot;
    end if;

    update public.tournament_matches set status = 'ready'
     where tournament_id = v_tid and round = v_round + 1 and slot = parent_slot
       and player_a is not null and player_b is not null and status = 'pending';
  else
    update public.tournaments set status = 'completed', end_date = now() where id = v_tid;
  end if;

  return new_match;
end;
$$;

revoke all on function public.create_tournament(jsonb) from public, anon, authenticated;
revoke all on function public.apply_tournament_result(jsonb) from public, anon, authenticated;
grant execute on function public.create_tournament(jsonb) to service_role;
grant execute on function public.apply_tournament_result(jsonb) to service_role;
