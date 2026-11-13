-- 0018_match_schedule.sql
-- When tournament matches are played.
--
-- Rounds get dates: at the draw, one round per weekday from the next weekday
-- on (round 1 the day after the draw, then the next round each weekday);
-- an admin can change any round's dates (tournament_rounds).
--
-- Matches get times: as soon as both players of a match are known, it gets
-- the first free slot in its round's dates, between 11:00 and 18:00 club time
-- (club_time_zone(), from 0016). There's one table, so matches never overlap:
-- a slot is 30 minutes for best of 3, 45 for best of 5 (60 for best of 7).
--
-- Players can move their match: either one proposes another time (11:00 to
-- 18:00, from today up to one day after the day it was planned for), and it
-- moves once the other accepts. An admin can move any match to any future
-- time, and give a walkover (the winner goes through; no rating change).
--
-- A match still not played the day after its date is overdue: the admins
-- are told once (the every-minute job from 0013 now calls tournament-kickoff
-- for that too).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.tournament_rounds (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round         integer not null check (round >= 1),
  starts_on     date not null,
  ends_on       date not null,
  primary key (tournament_id, round),
  constraint tournament_round_dates_in_order check (ends_on >= starts_on)
);

alter table public.tournament_rounds enable row level security;
create policy "tournament rounds readable by authenticated"
  on public.tournament_rounds for select to authenticated using (true);
revoke all on public.tournament_rounds from anon, authenticated;
grant select on public.tournament_rounds to authenticated;
grant select, insert, update, delete on public.tournament_rounds to service_role;

alter table public.tournament_matches
  add column scheduled_at       timestamptz,          -- when it's to be played
  add column planned_on         date,                 -- the day the app (or an admin) set: players can move it a day past it at most
  add column proposed_at        timestamptz,          -- another time one player proposed, until the other answers
  add column proposed_by        uuid references public.players (id) on delete set null,
  add column schedule_announced boolean not null default true,   -- false: its players haven't been told its (new) time
  add column overdue_notified   boolean not null default false,  -- the admins were told it wasn't played
  add column walkover           boolean not null default false;  -- won without playing (an admin's call)

-- ---------------------------------------------------------------------------
-- The rules
-- ---------------------------------------------------------------------------

-- Matches are played from 11:00 until 18:00, club time.
create or replace function public.club_opens() returns time language sql immutable as $$ select time '11:00' $$;
create or replace function public.club_closes() returns time language sql immutable as $$ select time '18:00' $$;

-- How long a match takes on the table.
create or replace function public.match_slot(best_of integer)
returns interval language sql immutable as $$
  select case when best_of <= 3 then interval '30 minutes'
              when best_of = 5 then interval '45 minutes'
              else interval '60 minutes' end
$$;

-- The weekday after d (Friday, Saturday and Sunday all lead to Monday).
create or replace function public.next_weekday(d date)
returns date language sql immutable as $$
  select d + case extract(isodow from d)::int when 5 then 3 when 6 then 2 else 1 end
$$;

-- A club-time day and time as a moment.
create or replace function public.club_moment(d date, t time)
returns timestamptz language sql stable as $$
  select (d + t) at time zone public.club_time_zone()
$$;

create or replace function public.club_today()
returns date language sql stable as $$
  select (now() at time zone public.club_time_zone())::date
$$;

grant execute on function public.club_opens(), public.club_closes(), public.match_slot(integer),
  public.next_weekday(date), public.club_moment(date, time), public.club_today()
  to authenticated, service_role;

-- The match on the table at [p_at, p_at + p_len), other than p_match, if any.
create or replace function public.clashing_match(p_match uuid, p_at timestamptz, p_len interval)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select o.id
    from public.tournament_matches o
    join public.tournaments ot on ot.id = o.tournament_id
   where o.status = 'ready' and o.scheduled_at is not null and o.id <> p_match
     and o.scheduled_at < p_at + p_len
     and o.scheduled_at + public.match_slot(ot.best_of) > p_at
   order by o.scheduled_at
   limit 1
$$;

-- Raises the reason if p_at can't be p_match's time. Players: 11:00 to 18:00,
-- from today until a day after the planned day. Admins: any future time. For
-- everyone: no clash on the table.
create or replace function public.check_match_time(p_match uuid, p_at timestamptz, p_by_admin boolean)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m        record;
  len      interval;
  local_at timestamp;
  latest   date;
  other    uuid;
  o        record;
begin
  select tm.planned_on, t.best_of into m
    from public.tournament_matches tm join public.tournaments t on t.id = tm.tournament_id
   where tm.id = p_match;
  len := public.match_slot(m.best_of);
  local_at := p_at at time zone public.club_time_zone();

  if p_at < now() + interval '5 minutes' then
    raise exception 'Pick a time in the future';
  end if;
  if not p_by_admin then
    if local_at::time < public.club_opens() or (local_at + len)::time > public.club_closes()
       or (local_at + len)::date <> local_at::date then
      raise exception 'Matches are played between % and %', to_char(public.club_opens(), 'HH24:MI'),
        to_char(public.club_closes(), 'HH24:MI');
    end if;
    latest := coalesce(m.planned_on, public.club_today()) + 1;
    if local_at::date > latest then
      raise exception 'It can be moved to % at the latest', to_char(latest, 'Dy FMDD Mon');
    end if;
  end if;

  other := public.clashing_match(p_match, p_at, len);
  if other is not null then
    select coalesce(pa.display_name, '?') as a, coalesce(pb.display_name, '?') as b, o2.scheduled_at as at,
           o2.scheduled_at + public.match_slot(t2.best_of) as till
      into o
      from public.tournament_matches o2
      join public.tournaments t2 on t2.id = o2.tournament_id
      left join public.players pa on pa.id = o2.player_a
      left join public.players pb on pb.id = o2.player_b
     where o2.id = other;
    raise exception 'The table is taken then: % v % (%-%)', o.a, o.b,
      to_char(o.at at time zone public.club_time_zone(), 'HH24:MI'),
      to_char(o.till at time zone public.club_time_zone(), 'HH24:MI');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Round dates and match times
-- ---------------------------------------------------------------------------

-- Gives every round of a drawn tournament dates, if it has none yet: one per
-- weekday, the first on the weekday after today.
create or replace function public.ensure_tournament_rounds(p_tournament uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  total integer;
  day   date;
  r     integer;
begin
  select case when t.size is null or t.size < 2 then null else round(log(2, t.size::numeric))::int end
    into total
    from public.tournaments t where t.id = p_tournament;
  if total is null then
    return;
  end if;
  select max(ends_on) into day from public.tournament_rounds where tournament_id = p_tournament;
  day := coalesce(day, public.club_today());
  for r in 1..total loop
    if not exists (select 1 from public.tournament_rounds where tournament_id = p_tournament and round = r) then
      day := public.next_weekday(day);
      insert into public.tournament_rounds (tournament_id, round, starts_on, ends_on) values (p_tournament, r, day, day);
    end if;
  end loop;
end;
$$;

-- Gives each match that's ready but has no time the first free slot in its
-- round's dates (from today on; past the round's last day, the next
-- weekdays). Returns how many got one.
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
begin
  if not exists (select 1 from public.tournaments where id = p_tournament and status = 'active' and size is not null) then
    return 0;
  end if;
  perform public.ensure_tournament_rounds(p_tournament);
  select public.match_slot(best_of) into len from public.tournaments where id = p_tournament;

  for m in
    select tm.id, tm.round
      from public.tournament_matches tm
     where tm.tournament_id = p_tournament and tm.status = 'ready' and tm.scheduled_at is null
       and tm.player_a is not null and tm.player_b is not null
     order by tm.round, tm.slot
  loop
    select * into rnd from public.tournament_rounds where tournament_id = p_tournament and round = m.round;
    day := greatest(rnd.starts_on, public.club_today());
    found := false;
    tries := 0;
    while not found and tries < 400 loop
      tries := tries + 1;
      if day > rnd.ends_on and extract(isodow from day) in (6, 7) then
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
        start_at := start_at + interval '15 minutes';
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

-- A match whose players just became known gets its time straight away
-- (after a result, a walkover, or new round dates); a whole bracket when the
-- draw is made (below, on the tournament).
create or replace function public.schedule_changed_matches()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  for tid in
    select distinct n.tournament_id from new_rows n
     where n.status = 'ready' and n.scheduled_at is null and n.player_a is not null and n.player_b is not null
  loop
    perform public.schedule_tournament_matches(tid);
  end loop;
  return null;
end;
$$;

create trigger tournament_matches_schedule_inserted
  after insert on public.tournament_matches
  referencing new table as new_rows
  for each statement execute function public.schedule_changed_matches();

create trigger tournament_matches_schedule_updated
  after update on public.tournament_matches
  referencing new table as new_rows
  for each statement execute function public.schedule_changed_matches();

create or replace function public.schedule_drawn_tournament()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.schedule_tournament_matches(new.id);
  return null;
end;
$$;

create trigger tournaments_schedule_on_draw
  after update of status, size on public.tournaments
  for each row
  when (new.status = 'active' and new.size is not null and (old.status is distinct from 'active' or old.size is distinct from new.size))
  execute function public.schedule_drawn_tournament();

-- ---------------------------------------------------------------------------
-- Players: propose another time, and answer
-- ---------------------------------------------------------------------------

create or replace function public.propose_match_time(p_match uuid, p_player uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.tournament_matches%rowtype;
begin
  select * into m from public.tournament_matches where id = p_match for update;
  if not found then
    raise exception 'Match not found';
  end if;
  if p_player is null or p_player not in (m.player_a, m.player_b) then
    raise exception 'Only the two players can propose another time';
  end if;
  if m.status <> 'ready' then
    raise exception 'This match isn''t waiting to be played';
  end if;
  if m.scheduled_at = p_at then
    raise exception 'That''s already its time';
  end if;
  perform public.check_match_time(p_match, p_at, false);
  update public.tournament_matches set proposed_at = p_at, proposed_by = p_player where id = p_match;
end;
$$;

-- The other player accepts (the match moves) or declines; the one who
-- proposed can withdraw it. Returns 'accepted', 'declined' or 'withdrawn'.
create or replace function public.answer_match_time(p_match uuid, p_player uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.tournament_matches%rowtype;
begin
  select * into m from public.tournament_matches where id = p_match for update;
  if not found then
    raise exception 'Match not found';
  end if;
  if p_player is null or p_player not in (m.player_a, m.player_b) then
    raise exception 'Only the two players can answer';
  end if;
  if m.status <> 'ready' or m.proposed_at is null then
    raise exception 'There''s no other time to answer';
  end if;

  if p_player = m.proposed_by then
    if p_accept then
      raise exception 'The other player has to accept it';
    end if;
    update public.tournament_matches set proposed_at = null, proposed_by = null where id = p_match;
    return 'withdrawn';
  end if;

  if not p_accept then
    update public.tournament_matches set proposed_at = null, proposed_by = null where id = p_match;
    return 'declined';
  end if;

  perform public.check_match_time(p_match, m.proposed_at, false);
  update public.tournament_matches
     set scheduled_at = m.proposed_at, proposed_at = null, proposed_by = null,
         schedule_announced = false, overdue_notified = false
   where id = p_match;
  return 'accepted';
end;
$$;

-- ---------------------------------------------------------------------------
-- Admins: move a match, change a round's dates, give a walkover
-- ---------------------------------------------------------------------------

create or replace function public.move_tournament_match(p_match uuid, p_admin uuid, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.tournament_matches%rowtype;
begin
  if not exists (select 1 from public.admins where player_id = p_admin) then
    raise exception 'Only admins can move a match';
  end if;
  select * into m from public.tournament_matches where id = p_match for update;
  if not found then
    raise exception 'Match not found';
  end if;
  if m.status <> 'ready' or m.player_a is null or m.player_b is null then
    raise exception 'Only a match waiting to be played can be moved';
  end if;
  perform public.check_match_time(p_match, p_at, true);
  update public.tournament_matches
     set scheduled_at = p_at, planned_on = (p_at at time zone public.club_time_zone())::date,
         proposed_at = null, proposed_by = null, schedule_announced = false, overdue_notified = false
   where id = p_match;
end;
$$;

-- New dates for a round. Its matches outside them get new times in them.
-- Returns how many matches got a new time.
create or replace function public.set_round_dates(p_tournament uuid, p_admin uuid, p_round integer, p_starts date, p_ends date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  moved integer;
begin
  if not exists (select 1 from public.admins where player_id = p_admin) then
    raise exception 'Only admins can change the dates';
  end if;
  if not exists (select 1 from public.tournaments where id = p_tournament and status = 'active') then
    raise exception 'Only a tournament in progress has round dates';
  end if;
  if p_starts is null or p_ends is null or p_ends < p_starts then
    raise exception 'The last day can''t be before the first';
  end if;
  if p_ends < public.club_today() then
    raise exception 'The round can''t end in the past';
  end if;
  perform public.ensure_tournament_rounds(p_tournament);
  update public.tournament_rounds set starts_on = p_starts, ends_on = p_ends
   where tournament_id = p_tournament and round = p_round;
  if not found then
    raise exception 'No round % in this tournament', p_round;
  end if;

  update public.tournament_matches
     set scheduled_at = null, planned_on = null, proposed_at = null, proposed_by = null
   where tournament_id = p_tournament and round = p_round and status = 'ready'
     and scheduled_at is not null
     and (scheduled_at at time zone public.club_time_zone())::date not between greatest(p_starts, public.club_today()) and p_ends;
  get diagnostics moved = row_count;
  -- (the update above has them scheduled again, in the new dates)
  return moved;
end;
$$;

-- The winner goes through without playing (no match, no rating change).
-- Returns true if that finished the tournament.
create or replace function public.give_walkover(p_match uuid, p_admin uuid, p_winner uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  m        public.tournament_matches%rowtype;
  total    integer;
begin
  if not exists (select 1 from public.admins where player_id = p_admin) then
    raise exception 'Only admins can give a walkover';
  end if;
  select * into m from public.tournament_matches where id = p_match for update;
  if not found then
    raise exception 'Match not found';
  end if;
  if m.status <> 'ready' or m.player_a is null or m.player_b is null then
    raise exception 'Only a match waiting to be played can be given as a walkover';
  end if;
  if p_winner is null or p_winner not in (m.player_a, m.player_b) then
    raise exception 'The winner has to be one of the two players';
  end if;

  update public.tournament_matches
     set winner_id = p_winner, status = 'completed', walkover = true, proposed_at = null, proposed_by = null
   where id = p_match;

  select max(round) into total from public.tournament_matches where tournament_id = m.tournament_id;
  if m.round < total then
    if m.slot % 2 = 0 then
      update public.tournament_matches set player_a = p_winner
       where tournament_id = m.tournament_id and round = m.round + 1 and slot = m.slot / 2;
    else
      update public.tournament_matches set player_b = p_winner
       where tournament_id = m.tournament_id and round = m.round + 1 and slot = m.slot / 2;
    end if;
    update public.tournament_matches set status = 'ready'
     where tournament_id = m.tournament_id and round = m.round + 1 and slot = m.slot / 2
       and player_a is not null and player_b is not null and status = 'pending';
    return false;
  end if;
  update public.tournaments set status = 'completed', end_date = now() where id = m.tournament_id;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Overdue: not played by the end of its day. The every-minute job calls
-- tournament-kickoff when an admin hasn't been told about one yet.
-- ---------------------------------------------------------------------------

create or replace function public.is_overdue(p_status text, p_scheduled_at timestamptz)
returns boolean language sql stable as $$
  select p_status = 'ready' and p_scheduled_at is not null
     and (p_scheduled_at at time zone public.club_time_zone())::date < public.club_today()
$$;

grant execute on function public.is_overdue(text, timestamptz) to authenticated, service_role;

create or replace function public.request_tournament_kickoff()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
      from public.tournaments t
     where t.status = 'registration'
       and t.kickoff_at <= now()
       and (select count(*) from public.tournament_participants tp where tp.tournament_id = t.id) >= 4
  ) or exists (
    select 1 from public.tournament_matches tm
     where not tm.overdue_notified and public.is_overdue(tm.status, tm.scheduled_at)
  ) then
    perform net.http_post(
      url := 'https://fdugzpsuznitvqwnrtim.supabase.co/functions/v1/tournament-kickoff',
      body := '{}'::jsonb,
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  end if;
end;
$$;

revoke all on function public.request_tournament_kickoff() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Access: the Edge Functions call these, as the service role.
-- ---------------------------------------------------------------------------

revoke all on function public.clashing_match(uuid, timestamptz, interval),
  public.check_match_time(uuid, timestamptz, boolean),
  public.ensure_tournament_rounds(uuid),
  public.schedule_tournament_matches(uuid),
  public.schedule_changed_matches(),
  public.schedule_drawn_tournament(),
  public.propose_match_time(uuid, uuid, timestamptz),
  public.answer_match_time(uuid, uuid, boolean),
  public.move_tournament_match(uuid, uuid, timestamptz),
  public.set_round_dates(uuid, uuid, integer, date, date),
  public.give_walkover(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.propose_match_time(uuid, uuid, timestamptz),
  public.answer_match_time(uuid, uuid, boolean),
  public.move_tournament_match(uuid, uuid, timestamptz),
  public.set_round_dates(uuid, uuid, integer, date, date),
  public.give_walkover(uuid, uuid, uuid),
  public.schedule_tournament_matches(uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Walkovers aren't wins for Dark Horse or Beast Killer: 0017's view, with
-- them left out of the bracket wins.
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
union all select player_id, 'partner_hopper', least(partners, 5), at_5 from partners;

-- ---------------------------------------------------------------------------
-- Tournaments already in progress: round dates and match times from the next
-- weekday (their players are told with the next result).
-- ---------------------------------------------------------------------------

do $$
declare
  tid uuid;
begin
  for tid in select id from public.tournaments where status = 'active' and size is not null loop
    perform public.schedule_tournament_matches(tid);
  end loop;
end;
$$;
