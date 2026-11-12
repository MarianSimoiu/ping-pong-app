-- 0015_titles.sql
-- Titles and trophies. Players earn achievements from their matches and
-- tournaments (a catalog below), see their progress toward each, and pick one
-- earned title to show under their name. Tournament honours (champion,
-- finalist) and the season-points leader also decorate avatars: a gold laurel
-- for champions, a crown for the leader.
--
-- Everything is worked out from the match history by views, so it covers
-- matches played before this existed and can't be faked: the app only picks
-- which earned title to show (players.title, checked by a trigger).
-- achievement_notices remembers which unlocks were announced, so each one is
-- pushed once (everything earned before this migration counts as announced).

-- ---------------------------------------------------------------------------
-- The catalog
-- ---------------------------------------------------------------------------

create table public.achievements (
  code        text primary key,
  name        text not null,
  description text not null,
  emoji       text not null,
  target      integer not null,   -- how many of something it takes
  sort        integer not null
);

insert into public.achievements (code, name, description, emoji, target, sort) values
  ('regular',          'Regular',          'Play 25 matches',                                        '🏓', 25,  10),
  ('iron_paddle',      'Iron Paddle',      'Play 100 matches',                                       '🛡️', 100, 20),
  ('social_butterfly', 'Social Butterfly', 'Play 15 different opponents',                            '🦋', 15,  30),
  ('giant_slayer',     'Giant Slayer',     'Beat someone rated 150+ points above you',               '🗡️', 1,   40),
  ('comeback_kid',     'Comeback Kid',     'Win a match after losing the first two games',           '🔄', 1,   50),
  ('bagel_baker',      'Bagel Baker',      'Win a game 11–0',                                        '🥯', 1,   60),
  ('deuce_master',     'Deuce Master',     'Win 10 games that went past 10–10',                      '🎯', 10,  70),
  ('on_fire',          'On Fire',          'Win 5 matches in a row against 3+ different opponents',  '🔥', 5,   80),
  ('doubles_dynamo',   'Doubles Dynamo',   'Win 20 doubles matches',                                 '🤝', 20,  90),
  ('finalist',         'Finalist',         'Reach a tournament final',                               '🎖️', 1,   100),
  ('champion',         'Champion',         'Win a tournament',                                       '🏆', 1,   110);

-- ---------------------------------------------------------------------------
-- Progress toward the match achievements: one row per player per achievement
-- they've made any progress on. earned_at is when it was first completed.
-- Singles count rated (confirmed) matches, in the order they were rated.
-- ---------------------------------------------------------------------------

create view public.achievement_progress
with (security_invoker = true)
as
with log as (
  select e.player_id, e.opponent_id, e.match_id, e.result, e.created_at as at,
         e.rating_before, o.rating_before as opponent_rating_before,
         row_number() over (partition by e.player_id order by e.created_at, e.match_id) as n
    from public.rating_events e
    join public.rating_events o on o.match_id = e.match_id and o.player_id = e.opponent_id
),
games as (  -- every game of those matches, from the player's side
  select l.player_id, l.match_id, l.at, g.game_no,
         case when m.player_a = l.player_id then g.score_a else g.score_b end as mine,
         case when m.player_a = l.player_id then g.score_b else g.score_a end as theirs
    from log l
    join public.matches m on m.id = l.match_id
    join public.match_games g on g.match_id = l.match_id
),
played as (
  select player_id, count(*)::int as matches,
         max(at) filter (where n = 25) as at_25,
         max(at) filter (where n = 100) as at_100
    from log group by player_id
),
opponents as (
  select player_id, count(*)::int as distinct_opponents,
         max(first_at) filter (where k = 15) as at_15
    from (select player_id, opponent_id, min(at) as first_at,
                 row_number() over (partition by player_id order by min(at), opponent_id) as k
            from log group by player_id, opponent_id) x
   group by player_id
),
giant as (
  select player_id, min(at) as earned_at from log
   where result = 'win' and opponent_rating_before - rating_before >= 150
   group by player_id
),
comeback as (
  select l.player_id, min(l.at) as earned_at
    from log l
    join games g1 on g1.player_id = l.player_id and g1.match_id = l.match_id and g1.game_no = 1 and g1.mine < g1.theirs
    join games g2 on g2.player_id = l.player_id and g2.match_id = l.match_id and g2.game_no = 2 and g2.mine < g2.theirs
   where l.result = 'win'
   group by l.player_id
),
bagel as (
  select player_id, min(at) as earned_at from games where mine >= 11 and theirs = 0 group by player_id
),
deuce as (  -- a game won after 10-10: the winner has at least 12
  select player_id, count(*)::int as won, max(at) filter (where k = 10) as at_10
    from (select player_id, at, row_number() over (partition by player_id order by at, match_id, game_no) as k
            from games where mine > theirs and mine >= 12) x
   group by player_id
),
runs as (  -- a new run starts at every loss
  select l.*, sum(case when l.result = 'loss' then 1 else 0 end) over (partition by l.player_id order by l.n) as run
    from log l
),
win_runs as (
  select player_id, run, at,
         row_number() over (partition by player_id, run order by n) as wins,
         sum(new_opponent) over (partition by player_id, run order by n) as opponents
    from (select r.*,
                 case when row_number() over (partition by r.player_id, r.run, r.opponent_id order by r.n) = 1
                      then 1 else 0 end as new_opponent
            from runs r where r.result = 'win') w
),
fire as (
  select w.player_id,
         min(w.at) filter (where w.wins >= 5 and w.opponents >= 3) as earned_at,
         coalesce(max(w.wins) filter (where w.run = c.current_run), 0)::int as current_streak
    from win_runs w
    join (select player_id, max(run) as current_run from runs group by player_id) c on c.player_id = w.player_id
   group by w.player_id
),
doubles as (
  select player_id, count(*)::int as won, max(at) filter (where k = 20) as at_20
    from (select p.player_id, coalesce(d.confirmed_at, d.played_at) as at,
                 row_number() over (partition by p.player_id order by coalesce(d.confirmed_at, d.played_at), d.id) as k
            from public.doubles_matches d
            join public.teams t on t.id = d.winner_team
            cross join lateral (values (t.player_low), (t.player_high)) p(player_id)
           where d.status = 'confirmed') x
   group by player_id
)
select player_id, 'regular'::text as code, least(matches, 25) as progress, at_25 as earned_at from played
union all select player_id, 'iron_paddle', least(matches, 100), at_100 from played
union all select player_id, 'social_butterfly', least(distinct_opponents, 15), at_15 from opponents
union all select player_id, 'giant_slayer', 1, earned_at from giant
union all select player_id, 'comeback_kid', 1, earned_at from comeback
union all select player_id, 'bagel_baker', 1, earned_at from bagel
union all select player_id, 'deuce_master', least(won, 10), at_10 from deuce
union all select player_id, 'on_fire',
                 case when earned_at is not null then 5 else least(current_streak, 4) end, earned_at
            from fire where earned_at is not null or current_streak > 0
union all select player_id, 'doubles_dynamo', least(won, 20), at_20 from doubles;

-- ---------------------------------------------------------------------------
-- Tournament honours: everyone who played a completed tournament's final.
-- ---------------------------------------------------------------------------

create view public.tournament_honours
with (security_invoker = true)
as
select f.player_id,
       t.id as tournament_id,
       t.name as tournament_name,
       f.player_id = final.winner_id as won,
       coalesce(t.end_date, t.created_at) as at
  from public.tournaments t
  join public.tournament_matches final
    on final.tournament_id = t.id
   and final.round = (select max(x.round) from public.tournament_matches x where x.tournament_id = t.id)
  cross join lateral (values (final.player_a), (final.player_b)) f(player_id)
 where t.status = 'completed' and f.player_id is not null and final.winner_id is not null;

-- ---------------------------------------------------------------------------
-- Every title a player can show, as stored in players.title: an achievement's
-- code, or 'champion:<tournament id>' for each tournament they won.
-- ---------------------------------------------------------------------------

create view public.earned_titles
with (security_invoker = true)
as
select a.player_id, a.code as title, c.name as label, a.earned_at
  from public.achievement_progress a
  join public.achievements c on c.code = a.code
 where a.earned_at is not null
union all
select player_id, 'finalist', 'Finalist', min(at)
  from public.tournament_honours group by player_id
union all
select player_id, 'champion:' || tournament_id::text, 'Champion · ' || tournament_name, at
  from public.tournament_honours where won;

alter table public.players add column title text;

create or replace function public.player_title_must_be_earned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.title is not null and not exists (
    select 1 from public.earned_titles e where e.player_id = new.id and e.title = new.title
  ) then
    raise exception 'That title isn''t earned yet' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.player_title_must_be_earned() from public, anon, authenticated;

create trigger players_title_must_be_earned
  before insert or update of title on public.players
  for each row execute function public.player_title_must_be_earned();

-- ---------------------------------------------------------------------------
-- Which unlocks were already announced (server only).
-- ---------------------------------------------------------------------------

create table public.achievement_notices (
  player_id  uuid not null references public.players (id) on delete cascade,
  code       text not null,
  ref        text not null default '',   -- the tournament, for 'champion'
  noticed_at timestamptz not null default now(),
  primary key (player_id, code, ref)
);

insert into public.achievement_notices (player_id, code)
select player_id, code from public.achievement_progress where earned_at is not null
on conflict do nothing;
insert into public.achievement_notices (player_id, code)
select distinct player_id, 'finalist' from public.tournament_honours
on conflict do nothing;
insert into public.achievement_notices (player_id, code, ref)
select player_id, 'champion', tournament_id::text from public.tournament_honours where won
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The avatars' extras, added to player_badges: tournaments won (the laurel),
-- the season-points leader (the crown: best 8 results of the last 52 weeks,
-- as the Season points tab), and the chosen title if it's still earned.
-- ---------------------------------------------------------------------------

create or replace view public.player_badges
with (security_invoker = true)
as
with leader as (
  select r.player_id
    from (select sp.player_id, sp.points,
                 row_number() over (partition by sp.player_id order by sp.points desc) as rn
            from public.season_points sp
           where sp.expires_at > now()) r
   where r.rn <= 8
   group by r.player_id
   order by sum(r.points) desc, r.player_id
   limit 1
),
wins as (
  select player_id, count(*)::int as champion_count from public.tournament_honours where won group by player_id
)
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
       coalesce(pr.last_played_at < now() - interval '30 days', false) as inactive,
       coalesce(w.champion_count, 0) as champion_count,
       exists (select 1 from leader l where l.player_id = pt.player_id) as season_leader,
       et.title,
       et.label as title_label
  from public.player_tiers pt
  join public.player_ratings pr on pr.player_id = pt.player_id
  join public.players pl on pl.id = pt.player_id
  left join wins w on w.player_id = pt.player_id
  left join public.earned_titles et on et.player_id = pt.player_id and et.title = pl.title;

-- ---------------------------------------------------------------------------
-- Access: the app reads all of it; it writes only its own players.title
-- (the existing "update own profile" policy), which the trigger checks.
-- ---------------------------------------------------------------------------

alter table public.achievements        enable row level security;
alter table public.achievement_notices enable row level security;

create policy "achievements readable by authenticated"
  on public.achievements for select to authenticated using (true);

revoke all on public.achievements, public.achievement_notices, public.achievement_progress,
              public.tournament_honours, public.earned_titles, public.player_badges
  from anon, authenticated;
grant select on public.achievements, public.achievement_progress, public.tournament_honours,
                public.earned_titles, public.player_badges
  to authenticated, service_role;
grant select, insert, update, delete on public.achievement_notices to service_role;
