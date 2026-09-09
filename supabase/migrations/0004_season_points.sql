-- 0004_season_points.sql
-- Phase 5: WTA-style season points. A SEPARATE number from the Glicko-2 skill
-- rating. Points are awarded for tournament placement (tier-weighted) and a
-- player's standing is the sum of their best-N results within a rolling 52-week
-- window (older results expire). See docs/RATING.md §4.

create table public.season_points (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.players (id) on delete cascade,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  placement     text not null,           -- 'Champion', 'Runner-up', 'Semifinalist', ...
  points        integer not null,
  awarded_at    timestamptz not null default now(),
  expires_at    timestamptz not null,    -- awarded_at + 52 weeks (rolling window)
  unique (player_id, tournament_id)       -- one award per player per tournament
);

create index season_points_player_idx on public.season_points (player_id, expires_at);

alter table public.season_points enable row level security;

create policy "season_points readable by authenticated"
  on public.season_points for select to authenticated using (true);
-- No client write policy: awards are written only by award_season_points (service role).

-- ---------------------------------------------------------------------------
-- award_season_points: insert one award per participant when a tournament ends.
-- Idempotent via the unique constraint (a re-run inserts nothing new).
-- ---------------------------------------------------------------------------

create or replace function public.award_season_points(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  award   jsonb;
  written integer := 0;
begin
  for award in select * from jsonb_array_elements(payload -> 'awards')
  loop
    insert into public.season_points (player_id, tournament_id, placement, points, expires_at)
    values (
      (award ->> 'player_id')::uuid,
      (payload ->> 'tournament_id')::uuid,
      award ->> 'placement',
      (award ->> 'points')::int,
      (award ->> 'expires_at')::timestamptz
    )
    on conflict (player_id, tournament_id) do nothing;
    written := written + 1;
  end loop;
  return written;
end;
$$;

revoke all on function public.award_season_points(jsonb) from public, anon, authenticated;
grant execute on function public.award_season_points(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- season_standings: the WTA-style ranking — best-N non-expired results summed
-- per player. Runs as the caller (RLS on season_points applies).
-- ---------------------------------------------------------------------------

create or replace function public.season_standings(best_n integer default 8)
returns table (player_id uuid, display_name text, points bigint, events integer)
language sql
stable
security invoker
set search_path = public
as $$
  with ranked as (
    select sp.player_id,
           sp.points,
           row_number() over (partition by sp.player_id order by sp.points desc) as rn
    from public.season_points sp
    where sp.expires_at > now()
  )
  select r.player_id,
         pl.display_name,
         sum(r.points)::bigint as points,
         count(*)::int as events
  from ranked r
  join public.players pl on pl.id = r.player_id
  where r.rn <= best_n
  group by r.player_id, pl.display_name
  order by points desc;
$$;

grant execute on function public.season_standings(integer) to authenticated;
