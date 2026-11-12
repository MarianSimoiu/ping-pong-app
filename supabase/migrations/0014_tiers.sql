-- 0014_tiers.sql
-- Tiers: Bronze, Silver, Gold, Platinum, Diamond, from the skill rating, for
-- players on the leaderboard (3+ confirmed matches; "unranked" before). The
-- app shows them as a colored ring around avatars. #1 on the leaderboard
-- shows as Legend (worked out by the player_badges view, not stored).
--
-- A player goes up as soon as their rating reaches the next tier's line, and
-- down only once it's 25 points under their tier's line, so one bad match
-- near a line doesn't flip them back and forth. Each move is recorded in
-- tier_changes, which the match functions use to notify promotions.

-- ---------------------------------------------------------------------------
-- The lines: the lowest rating of each tier (Bronze is everything below
-- Silver). Set from the ratings at the time this runs, so the tiers fit the
-- players: about 20% Bronze, 30% Silver, 25% Gold, 15% Platinum, 10% Diamond,
-- with lines at least 50 points apart; 1400 / 1500 / 1600 / 1700 while fewer
-- than 10 players are on the leaderboard. To move a line later:
--   update public.tier_lines set min_rating = 1650 where tier = 'diamond';
--   select public.refresh_player_tiers();
-- ---------------------------------------------------------------------------

create table public.tier_lines (
  tier       text primary key check (tier in ('silver', 'gold', 'platinum', 'diamond')),
  min_rating double precision not null
);

with ranked as (
  select rating from public.player_ratings where matches_played >= 3
), stats as (
  select count(*) as n,
         round(percentile_cont(0.20) within group (order by rating)::numeric, -1)::float8 as p20,
         round(percentile_cont(0.50) within group (order by rating)::numeric, -1)::float8 as p50,
         round(percentile_cont(0.75) within group (order by rating)::numeric, -1)::float8 as p75,
         round(percentile_cont(0.90) within group (order by rating)::numeric, -1)::float8 as p90
  from ranked
), lines as (
  select case when n >= 10 then p20 else 1400 end as silver,
         case when n >= 10 then p50 else 1500 end as gold,
         case when n >= 10 then p75 else 1600 end as platinum,
         case when n >= 10 then p90 else 1700 end as diamond
  from stats
), spaced as (
  select silver,
         greatest(gold, silver + 50) as gold,
         platinum,
         diamond
  from lines
), spaced2 as (
  select silver, gold, greatest(platinum, gold + 50) as platinum, diamond from spaced
), spaced3 as (
  select silver, gold, platinum, greatest(diamond, platinum + 50) as diamond from spaced2
)
insert into public.tier_lines (tier, min_rating)
select 'silver', silver from spaced3
union all select 'gold', gold from spaced3
union all select 'platinum', platinum from spaced3
union all select 'diamond', diamond from spaced3;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.tier_rank(t text)
returns integer
language sql
immutable
as $$
  select case t
    when 'unranked' then 0 when 'bronze' then 1 when 'silver' then 2
    when 'gold' then 3 when 'platinum' then 4 when 'diamond' then 5
  end
$$;

-- The tier a rating falls in (on the leaderboard).
create or replace function public.tier_for_rating(r double precision)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select l.tier from public.tier_lines l where l.min_rating <= r
      order by public.tier_rank(l.tier) desc limit 1),
    'bronze')
$$;

-- ---------------------------------------------------------------------------
-- Each player's tier, kept up to date from player_ratings by a trigger.
-- ---------------------------------------------------------------------------

create table public.player_tiers (
  player_id  uuid primary key references public.players (id) on delete cascade,
  tier       text not null check (public.tier_rank(tier) is not null),
  since      timestamptz not null default now(),
  best_tier  text not null check (public.tier_rank(best_tier) is not null)  -- highest ever
);

create table public.tier_changes (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references public.players (id) on delete cascade,
  from_tier  text not null,
  to_tier    text not null,
  changed_at timestamptz not null default now(),
  notified   boolean not null default false
);

create index tier_changes_unnotified_idx on public.tier_changes (player_id) where not notified;

-- How far under a tier's line a player can fall before dropping out of it.
create or replace function public.tier_hysteresis()
returns double precision language sql immutable as $$ select 25::double precision $$;

create or replace function public.update_player_tier()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_tier text;
  target       text;
  lower_tier   text;
begin
  target := case when new.matches_played >= 3 then public.tier_for_rating(new.rating) else 'unranked' end;
  select tier into current_tier from public.player_tiers where player_id = new.player_id;

  if current_tier is null then
    insert into public.player_tiers (player_id, tier, best_tier) values (new.player_id, target, target);
    if target <> 'unranked' then
      insert into public.tier_changes (player_id, from_tier, to_tier) values (new.player_id, 'unranked', target);
    end if;
    return null;
  end if;

  if public.tier_rank(target) > public.tier_rank(current_tier) then
    update public.player_tiers
       set tier = target,
           since = now(),
           best_tier = case when public.tier_rank(target) > public.tier_rank(best_tier) then target else best_tier end
     where player_id = new.player_id;
    insert into public.tier_changes (player_id, from_tier, to_tier) values (new.player_id, current_tier, target);
  elsif public.tier_rank(target) < public.tier_rank(current_tier) then
    -- Down only past the margin (or off the leaderboard entirely, if matches
    -- were deleted): rating + margin must be under the current tier's line.
    lower_tier := case
      when target = 'unranked' then 'unranked'
      else public.tier_for_rating(new.rating + public.tier_hysteresis())
    end;
    if public.tier_rank(lower_tier) < public.tier_rank(current_tier) then
      update public.player_tiers set tier = lower_tier, since = now() where player_id = new.player_id;
      insert into public.tier_changes (player_id, from_tier, to_tier) values (new.player_id, current_tier, lower_tier);
    end if;
  end if;
  return null;
end;
$$;

create trigger player_ratings_update_tier
  after insert or update of rating, matches_played on public.player_ratings
  for each row execute function public.update_player_tier();

-- Sets every player's tier straight from their rating (no margin, nothing
-- recorded): for the start, and after moving a line.
create or replace function public.refresh_player_tiers()
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.player_tiers (player_id, tier, best_tier)
  select r.player_id, t.tier, t.tier
    from public.player_ratings r
    cross join lateral (
      select case when r.matches_played >= 3 then public.tier_for_rating(r.rating) else 'unranked' end as tier
    ) t
  on conflict (player_id) do update
    set tier = excluded.tier,
        since = case when public.player_tiers.tier = excluded.tier then public.player_tiers.since else now() end,
        best_tier = case
          when public.tier_rank(excluded.tier) > public.tier_rank(public.player_tiers.best_tier) then excluded.tier
          else public.player_tiers.best_tier
        end;
$$;

select public.refresh_player_tiers();

-- ---------------------------------------------------------------------------
-- What the app shows on avatars: one row per player.
--   legend:   #1 on the leaderboard (best rating with 3+ matches)
--   inactive: no rated match for 30 days (the ring greys out)
-- ---------------------------------------------------------------------------

create view public.player_badges
with (security_invoker = true)
as
select pt.player_id,
       pt.tier,
       pt.best_tier,
       pt.since as tier_since,
       coalesce(pr.player_id = (
         select r.player_id from public.player_ratings r
          where r.matches_played >= 3
          order by r.rating desc, r.player_id
          limit 1
       ), false) as legend,
       coalesce(pr.last_played_at < now() - interval '30 days', false) as inactive
  from public.player_tiers pt
  join public.player_ratings pr on pr.player_id = pt.player_id;

-- ---------------------------------------------------------------------------
-- Access: the app reads lines, tiers and badges; only the server writes them
-- (through the trigger); tier_changes is the server's own.
-- ---------------------------------------------------------------------------

alter table public.tier_lines   enable row level security;
alter table public.player_tiers enable row level security;
alter table public.tier_changes enable row level security;

create policy "tier_lines readable by authenticated"
  on public.tier_lines for select to authenticated using (true);
create policy "player_tiers readable by authenticated"
  on public.player_tiers for select to authenticated using (true);

revoke all on public.tier_lines, public.player_tiers, public.tier_changes, public.player_badges
  from anon, authenticated;
grant select on public.tier_lines, public.player_tiers, public.player_badges to authenticated;
grant select, insert, update, delete on public.tier_lines, public.player_tiers, public.tier_changes to service_role;
grant select on public.player_badges to service_role;

revoke all on function public.update_player_tier() from public, anon, authenticated;
revoke all on function public.refresh_player_tiers() from public, anon, authenticated;
grant execute on function public.refresh_player_tiers() to service_role;
