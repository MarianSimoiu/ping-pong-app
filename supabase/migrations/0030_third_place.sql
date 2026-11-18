-- 0030_third_place.sql
-- A match for third place. Until now both semifinal losers shared third place,
-- a bronze medal each (0021). Now they play each other for it, like the
-- Olympics' bronze medal match: the winner takes third place and the bronze,
-- the loser finishes fourth.
--
-- It's the last round's second match: the final is (last round, slot 0), the
-- third-place match (last round, slot 1). The draw adds it (bracket.ts); each
-- semifinal's loser takes their side as soon as their semifinal is decided
-- (side A from the first semifinal, side B from the second), and it gets its
-- time like any other match, ahead of the final when both are waiting, so the
-- final is the tournament's last match. The tournament is over, with its
-- season points, once the final and the third-place match both are.
--
-- Tournaments being played get theirs now; finished ones keep both bronzes.
-- What took "the last round" to be the final now takes its slot 0: champions
-- and finalists (tournament_honours), the podium, and the tournament winners
-- behind Supernova (achievement_progress). A third-place win doesn't make a
-- Dark Horse run either.

-- ---------------------------------------------------------------------------
-- Seats the semifinal losers decided so far in the third-place match, and
-- makes it ready once both are in.
-- ---------------------------------------------------------------------------

create or replace function public.seat_third_place(p_tournament uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  total integer;
begin
  select max(round) into total from public.tournament_matches where tournament_id = p_tournament;
  if total is null or total < 2 then
    return;
  end if;
  update public.tournament_matches tp
     set player_a = coalesce(tp.player_a, (
           select case when s.winner_id = s.player_a then s.player_b else s.player_a end
             from public.tournament_matches s
            where s.tournament_id = p_tournament and s.round = total - 1 and s.slot = 0
              and s.status = 'completed' and s.winner_id is not null)),
         player_b = coalesce(tp.player_b, (
           select case when s.winner_id = s.player_a then s.player_b else s.player_a end
             from public.tournament_matches s
            where s.tournament_id = p_tournament and s.round = total - 1 and s.slot = 1
              and s.status = 'completed' and s.winner_id is not null))
   where tp.tournament_id = p_tournament and tp.round = total and tp.slot = 1 and tp.status = 'pending';
  update public.tournament_matches
     set status = 'ready'
   where tournament_id = p_tournament and round = total and slot = 1 and status = 'pending'
     and player_a is not null and player_b is not null;
end;
$$;

-- ---------------------------------------------------------------------------
-- After a match: the winner goes on to their next match (ready once both its
-- players are known, when it gets its time: 0018, 0029); a semifinal's loser
-- goes to the third-place match, seated first so it's the one that gets the
-- earlier time. The tournament is over once every match of the last round
-- (the final and the third-place match) is. Returns true when it is.
-- ---------------------------------------------------------------------------

create or replace function public.advance_tournament_winner(p_tournament uuid, p_round integer, p_slot integer, p_winner uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  total integer;
begin
  select max(round) into total from public.tournament_matches where tournament_id = p_tournament;
  if p_round < total then
    if p_slot % 2 = 0 then
      update public.tournament_matches set player_a = p_winner
       where tournament_id = p_tournament and round = p_round + 1 and slot = p_slot / 2;
    else
      update public.tournament_matches set player_b = p_winner
       where tournament_id = p_tournament and round = p_round + 1 and slot = p_slot / 2;
    end if;
    if p_round = total - 1 then
      perform public.seat_third_place(p_tournament);
    end if;
    update public.tournament_matches set status = 'ready'
     where tournament_id = p_tournament and round = p_round + 1 and slot = p_slot / 2
       and player_a is not null and player_b is not null and status = 'pending';
    return false;
  end if;
  if exists (select 1 from public.tournament_matches
              where tournament_id = p_tournament and round = total and status <> 'completed') then
    return false;
  end if;
  update public.tournaments set status = 'completed', end_date = now() where id = p_tournament;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 0029's scheduling, with the third-place match ahead of the final when both
-- are waiting for a time (an admin moving the last round's days, say).
-- ---------------------------------------------------------------------------

create or replace function public.schedule_tournament_matches(p_tournament uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  m        record;
  rnd      record;
  len      interval;
  day      date;
  start_at timestamptz;
  closes   timestamptz;
  found    boolean;
  tries    integer;
  n        integer := 0;
  started  boolean;
  asap     boolean;
  total    integer;
begin
  if not exists (select 1 from public.tournaments where id = p_tournament and status = 'active' and size is not null) then
    return 0;
  end if;
  perform public.ensure_tournament_rounds(p_tournament);
  select public.match_slot(best_of) into len from public.tournaments where id = p_tournament;
  select max(round) into total from public.tournament_matches where tournament_id = p_tournament;
  -- Play has started: a match was played, or given as a walkover (a bye is not).
  started := exists (
    select 1 from public.tournament_matches
     where tournament_id = p_tournament and status = 'completed'
       and player_a is not null and player_b is not null);

  for m in
    select tm.id, tm.round
      from public.tournament_matches tm
     where tm.tournament_id = p_tournament and tm.status = 'ready' and tm.scheduled_at is null
       and tm.player_a is not null and tm.player_b is not null
     order by tm.round, (tm.round = total and tm.slot = 1) desc, tm.slot
  loop
    select * into rnd from public.tournament_rounds where tournament_id = p_tournament and round = m.round;
    asap := started and not rnd.fixed;
    day := case when asap then public.club_today() else greatest(rnd.starts_on, public.club_today()) end;
    found := false;
    tries := 0;
    while not found and tries < 400 loop
      tries := tries + 1;
      -- Weekdays only, except the days an admin gave a round.
      if (asap or day > rnd.ends_on) and extract(isodow from day) in (6, 7) then
        day := day + 1;
        continue;
      end if;
      start_at := public.club_moment(day, public.club_opens());
      closes := public.club_moment(day, public.club_closes());
      while start_at + len <= closes loop
        if start_at >= now() + interval '15 minutes' and public.clashing_match(m.id, start_at, len) is null then
          found := true;
          exit;
        end if;
        start_at := start_at + interval '5 minutes';
      end loop;
      if not found then
        day := day + 1;
      end if;
    end loop;

    if found then
      update public.tournament_matches
         set scheduled_at = start_at, planned_on = day, proposed_at = null, proposed_by = null,
             schedule_announced = false, overdue_notified = false
       where id = m.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

revoke all on function public.seat_third_place(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tournaments being played get their third-place match now, with the
-- semifinal losers decided so far. (Their semifinals are real matches: a bye
-- is only ever in round 1, so a two-round tournament with one has none.)
-- ---------------------------------------------------------------------------

insert into public.tournament_matches (tournament_id, round, slot, status)
select t.id, f.round, 1, 'pending'
  from public.tournaments t
  join public.tournament_matches f
    on f.tournament_id = t.id and f.slot = 0
   and f.round = (select max(x.round) from public.tournament_matches x where x.tournament_id = t.id)
 where t.status = 'active'
   and f.round >= 2
   and not exists (select 1 from public.tournament_matches x
                    where x.tournament_id = t.id and x.round = f.round and x.slot = 1)
   and not exists (select 1 from public.tournament_matches s
                    where s.tournament_id = t.id and s.round = f.round - 1
                      and s.status = 'completed' and (s.player_a is null or s.player_b is null));

do $$
declare
  tid uuid;
begin
  for tid in select id from public.tournaments where status = 'active' loop
    perform public.seat_third_place(tid);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Champions and finalists: the final is the last round's slot 0 (0015).
-- ---------------------------------------------------------------------------

create or replace view public.tournament_honours
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
   and final.slot = 0
   and final.round = (select max(x.round) from public.tournament_matches x where x.tournament_id = t.id)
  cross join lateral (values (final.player_a), (final.player_b)) f(player_id)
 where t.status = 'completed' and f.player_id is not null and final.winner_id is not null;

-- ---------------------------------------------------------------------------
-- The podium (0021): the final's winner and loser, then third place: the
-- third-place match's winner, or (in tournaments from before it) both
-- semifinal losers.
-- ---------------------------------------------------------------------------

create or replace view public.tournament_podium
with (security_invoker = true)
as
with done as (
  select t.id, t.name, coalesce(t.end_date, t.created_at) as at,
         (select max(x.round) from public.tournament_matches x where x.tournament_id = t.id) as final_round
    from public.tournaments t
   where t.status = 'completed'
),
places as (
  -- The final: its winner first, the other finalist second.
  select d.id as tournament_id, f.player_id,
         case when f.player_id = m.winner_id then 1 else 2 end as place
    from done d
    join public.tournament_matches m on m.tournament_id = d.id and m.round = d.final_round and m.slot = 0
    cross join lateral (values (m.player_a), (m.player_b)) f(player_id)
   where f.player_id is not null and m.winner_id is not null
  union all
  -- The third-place match: its winner third.
  select d.id, m.winner_id, 3
    from done d
    join public.tournament_matches m on m.tournament_id = d.id and m.round = d.final_round and m.slot = 1
   where m.winner_id is not null
  union all
  -- Before third-place matches: both semifinal losers third (a bye isn't a semifinal).
  select d.id, case when m.winner_id = m.player_a then m.player_b else m.player_a end, 3
    from done d
    join public.tournament_matches m on m.tournament_id = d.id and m.round = d.final_round - 1
   where m.winner_id is not null and m.player_a is not null and m.player_b is not null
     and not exists (select 1 from public.tournament_matches x
                      where x.tournament_id = d.id and x.round = d.final_round and x.slot = 1)
)
select p.tournament_id, d.name as tournament_name, d.at, p.place, p.player_id, pl.display_name
  from places p
  join done d on d.id = p.tournament_id
  join public.players pl on pl.id = p.player_id;

-- ---------------------------------------------------------------------------
-- Progress: 0025's view, with the tournament winners (cup_winner, behind
-- Supernova) from the final only, and Dark Horse not counting a third-place
-- win (bracket gains its slot for that).
-- ---------------------------------------------------------------------------

create or replace view public.achievement_progress
with (security_invoker = true)
as
with numbered as (  -- each player's rated matches in order: k = 1 is their first
  select r.match_id, r.player_id, r.rating_before,
         row_number() over (partition by r.player_id order by r.created_at, r.match_id) as k
    from public.rating_events r
),
log as (
  select e.player_id, e.opponent_id, e.match_id, e.result, e.created_at as at,
         e.rating_before, o.rating_before as opponent_rating_before,
         o.k - 1 as opponent_matches_before,  -- 0023: the opponent's rated matches before this one
         row_number() over (partition by e.player_id order by e.created_at, e.match_id) as n
    from public.rating_events e
    join numbered o on o.match_id = e.match_id and o.player_id = e.opponent_id
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
     and opponent_matches_before >= public.giant_slayer_min_matches()
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
  select w.winner_id as player_id, w.tournament_id, w.round, w.slot, w.player_a, w.player_b,
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
     and not (b.round = b.final_round and b.slot = 1)  -- not the third-place match (0030)
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
),
-- 0024 ------------------------------------------------------------------------
head_to_head as (  -- every pairing, match by match, from the player's side
  select player_id, opponent_id, at,
         row_number() over (partition by player_id, opponent_id order by n) as played,
         sum(case when result = 'win' then 1 else 0 end)
           over (partition by player_id, opponent_id order by n) as won
    from log
),
farmer as (  -- the first time they had played someone enough, and won enough of it
  select player_id,
         min(at) filter (where played >= public.farmer_min_matches()
                           and won * 100 >= played * public.farmer_min_percent()) as earned_at
    from head_to_head
   group by player_id
),
farmer_now as (  -- the most matches against someone they're beating often enough, as it stands
  select player_id,
         coalesce(max(least(played, public.farmer_min_matches()))
                    filter (where won * 100 >= played * public.farmer_min_percent()), 0)::int as best
    from (select player_id, opponent_id, max(played) as played, max(won) as won
            from head_to_head group by player_id, opponent_id) pairing
   group by player_id
),
-- 0025 ------------------------------------------------------------------------
cup_winner as (  -- each tournament's winner: whoever won its final
  select m.tournament_id, m.winner_id
    from public.tournament_matches m
   where m.round = (select max(x.round) from public.tournament_matches x where x.tournament_id = m.tournament_id)
     and m.slot = 0  -- the final, not the third-place match (0030)
),
cups as (  -- every completed tournament each player played in, in the order they finished
  select t.id as tournament_id, p.player_id, coalesce(t.end_date, t.created_at) as at,
         coalesce(p.player_id = w.winner_id, false) as won
    from public.tournaments t
    join cup_winner w on w.tournament_id = t.id
    join (select distinct m.tournament_id, x.player_id
            from public.tournament_matches m
            cross join lateral (values (m.player_a), (m.player_b)) x(player_id)
           where x.player_id is not null) p on p.tournament_id = t.id
   where t.status = 'completed'
),
cup_runs as (  -- a new run starts at every tournament played and not won
  select c.*,
         sum(case when c.won then 0 else 1 end) over (partition by c.player_id order by c.at, c.tournament_id) as run
    from cups c
),
supernova as (  -- three tournaments won in a row, and the current run
  select w.player_id,
         min(w.at) filter (where w.wins >= 3) as earned_at,
         coalesce(max(w.wins) filter (where w.run = c.current_run), 0)::int as current_streak
    from (select player_id, run, at,
                 row_number() over (partition by player_id, run order by at, tournament_id) as wins
            from cup_runs where won) w
    join (select player_id, max(run) as current_run from cup_runs group by player_id) c on c.player_id = w.player_id
   group by w.player_id
),
unlucky as (  -- lost the first match they played in a tournament (a bye or a walkover isn't played)
  select player_id, min(at) as earned_at
    from (select x.player_id, m.winner_id,
                 coalesce(mm.played_at, t.end_date, t.created_at) as at,
                 row_number() over (partition by x.player_id, m.tournament_id order by m.round) as k
            from public.tournament_matches m
            join public.tournaments t on t.id = m.tournament_id
            left join public.matches mm on mm.id = m.match_id
            cross join lateral (values (m.player_a), (m.player_b)) x(player_id)
           where m.player_a is not null and m.player_b is not null
             and m.winner_id is not null and not m.walkover) first_played
   where k = 1 and winner_id <> player_id
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
union all select player_id, 'doubles_dynamo', least(won, 20), at_20 from doubles
union all select player_id, 'lunch_break_legend', least(won, 10), at_10 from lunch
union all select player_id, 'night_owl', 1, earned_at from owl
union all select player_id, 'touch_grass', least(best, 10), at_10 from busy
union all select player_id, 'coin_flip', 1, earned_at from coin where earned_at is not null
union all select player_id, 'dark_horse', 1, earned_at from dark_horse
union all select player_id, 'seed_killer', 1, earned_at from seed_killer
union all select player_id, 'ride_or_die', least(best, 10), at_10 from duo
union all select player_id, 'partner_hopper', least(partners, 5), at_5 from partners
union all select player_id, 'unkillable_demon_king', 1, earned_at from demon_king
union all select f.player_id, 'farmer',
                 case when f.earned_at is not null then public.farmer_min_matches() else n.best end,
                 f.earned_at
            from farmer f
            join farmer_now n on n.player_id = f.player_id
           where f.earned_at is not null or n.best > 0
union all select player_id, 'supernova',
                 case when earned_at is not null then 3 else least(current_streak, 2) end, earned_at
            from supernova where earned_at is not null or current_streak > 0
union all select player_id, 'unlucky', 1, earned_at from unlucky;
