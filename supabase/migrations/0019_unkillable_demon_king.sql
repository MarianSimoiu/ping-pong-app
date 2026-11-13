-- 0019_unkillable_demon_king.sql
-- Unkillable Demon King 👹: win a tournament without losing a single game.
-- Worked out from the tournament's recorded games like the other titles
-- (0015), so tournaments already played count. A walkover or a bye is no
-- game, won or lost, but at least one match has to be played.
--
-- Like 0016, nothing is marked as announced: a player who already qualifies
-- hears about it with their next match (and sees the app's "new titles"
-- popup on their next visit).

insert into public.achievements (code, name, description, emoji, target, sort) values
  ('unkillable_demon_king', 'Unkillable Demon King', 'Win a tournament without losing a single game', '👹', 1, 112);

-- ---------------------------------------------------------------------------
-- Progress: 0018's view, plus Unkillable Demon King (demon_king).
-- ---------------------------------------------------------------------------

create or replace view public.achievement_progress
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
   where result = 'win' and opponent_rating_before - rating_before >= public.giant_slayer_gap()
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
),
-- 0016 ------------------------------------------------------------------------
day_log as (  -- every match played, singles and doubles, in the club's time
  select l.player_id, l.result = 'win' as won, m.played_at as at,
         m.played_at at time zone public.club_time_zone() as local_at
    from log l
    join public.matches m on m.id = l.match_id
  union all
  select p.player_id, d.winner_team = t.id, d.played_at,
         d.played_at at time zone public.club_time_zone()
    from public.doubles_matches d
    join public.teams t on t.id in (d.team_a, d.team_b)
    cross join lateral (values (t.player_low), (t.player_high)) p(player_id)
   where d.status = 'confirmed'
),
lunch as (
  select player_id, count(*)::int as won, max(at) filter (where k = 10) as at_10
    from (select player_id, at, row_number() over (partition by player_id order by at) as k
            from day_log
           where won and local_at::time >= time '12:00' and local_at::time < time '14:00') x
   group by player_id
),
owl as (  -- from 20:00 until 04:00
  select player_id, min(at) as earned_at
    from day_log
   where local_at::time >= time '20:00' or local_at::time < time '04:00'
   group by player_id
),
busy as (  -- the most matches in one day, and when a day first reached 10
  select player_id, max(k)::int as best, min(at) filter (where k = 10) as at_10
    from (select player_id, at, row_number() over (partition by player_id, local_at::date order by at) as k
            from day_log) x
   group by player_id
),
coin as (  -- the first time, 20+ matches in, wins equal losses
  select player_id, min(at) filter (where n >= 20 and wins * 2 = n) as earned_at
    from (select player_id, n, at,
                 sum(case when result = 'win' then 1 else 0 end) over (partition by player_id order by n) as wins
            from log) x
   group by player_id
),
bracket as (  -- every real (not a bye) tournament win, with when and how deep
  select w.winner_id as player_id, w.tournament_id, w.round, w.player_a, w.player_b,
         coalesce(m.played_at, t.end_date, t.created_at) as at,
         (select max(x.round) from public.tournament_matches x where x.tournament_id = w.tournament_id) as final_round
    from public.tournament_matches w
    join public.tournaments t on t.id = w.tournament_id
    left join public.matches m on m.id = w.match_id
   where w.winner_id is not null and w.player_a is not null and w.player_b is not null and not w.walkover
),
dark_horse as (  -- a win from the bottom pot that takes them to the semifinals or further
  select b.player_id, min(b.at) as earned_at
    from bracket b
    join public.tournament_participants tp on tp.tournament_id = b.tournament_id and tp.player_id = b.player_id
   where b.round >= b.final_round - 2
     and tp.pot is not null
     and tp.pot = (select max(x.pot) from public.tournament_participants x where x.tournament_id = b.tournament_id)
     and tp.pot > 1
   group by b.player_id
),
seed_killer as (
  select b.player_id, min(b.at) as earned_at
    from bracket b
    join public.tournament_participants s
      on s.tournament_id = b.tournament_id and s.seed = 1 and s.player_id in (b.player_a, b.player_b)
   where s.player_id <> b.player_id
   group by b.player_id
),
duo as (  -- doubles wins with each partner (a team is one pair)
  select player_id, max(k)::int as best, min(at) filter (where k = 10) as at_10
    from (select p.player_id, coalesce(d.confirmed_at, d.played_at) as at,
                 row_number() over (partition by p.player_id, t.id
                                    order by coalesce(d.confirmed_at, d.played_at), d.id) as k
            from public.doubles_matches d
            join public.teams t on t.id = d.winner_team
            cross join lateral (values (t.player_low), (t.player_high)) p(player_id)
           where d.status = 'confirmed') x
   group by player_id
),
partners as (  -- different partners played doubles with
  select player_id, count(*)::int as partners, max(first_at) filter (where k = 5) as at_5
    from (select p.player_id, t.id as team_id, min(coalesce(d.confirmed_at, d.played_at)) as first_at,
                 row_number() over (partition by p.player_id
                                    order by min(coalesce(d.confirmed_at, d.played_at)), t.id) as k
            from public.doubles_matches d
            join public.teams t on t.id in (d.team_a, d.team_b)
            cross join lateral (values (t.player_low), (t.player_high)) p(player_id)
           where d.status = 'confirmed'
           group by p.player_id, t.id) x
   group by player_id
),
-- 0019 ------------------------------------------------------------------------
demon_king as (  -- a tournament won without losing a single game in it
  select h.player_id, min(h.at) as earned_at
    from public.tournament_honours h
   where h.won
     -- at least one match played (walkovers and byes count neither way)...
     and exists (select 1 from public.tournament_matches tm
                  where tm.tournament_id = h.tournament_id and tm.winner_id = h.player_id
                    and tm.match_id is not null)
     -- ...and not one game lost in any of them
     and not exists (select 1
                       from public.tournament_matches tm
                       join public.matches m on m.id = tm.match_id
                       join public.match_games g on g.match_id = m.id
                      where tm.tournament_id = h.tournament_id
                        and h.player_id in (m.player_a, m.player_b)
                        and case when m.player_a = h.player_id then g.score_a < g.score_b
                                 else g.score_b < g.score_a end)
   group by h.player_id
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
union all select player_id, 'doubles_dynamo', least(won, 20), at_20 from doubles
union all select player_id, 'lunch_break_legend', least(won, 10), at_10 from lunch
union all select player_id, 'night_owl', 1, earned_at from owl
union all select player_id, 'touch_grass', least(best, 10), at_10 from busy
union all select player_id, 'coin_flip', 1, earned_at from coin where earned_at is not null
union all select player_id, 'dark_horse', 1, earned_at from dark_horse
union all select player_id, 'seed_killer', 1, earned_at from seed_killer
union all select player_id, 'ride_or_die', least(best, 10), at_10 from duo
union all select player_id, 'partner_hopper', least(partners, 5), at_5 from partners
union all select player_id, 'unkillable_demon_king', 1, earned_at from demon_king;
