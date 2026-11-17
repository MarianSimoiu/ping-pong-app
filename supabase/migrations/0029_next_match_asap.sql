-- 0029_next_match_asap.sql
-- The next match as soon as possible. Until now a match got a time on its
-- round's days (one weekday per round, 0018), even when both its players were
-- known earlier. Now, once play has started (a match was played or given as a
-- walkover), a match whose two players are known gets the first free time on
-- the table from then on: from 15 minutes later, 11:00 to 18:00, weekdays,
-- today if there's room. So the winners play on the same afternoon when the
-- table's free, and the tournament takes fewer days.
--
-- At the draw nothing changes: round 1 starts the weekday after it, on its
-- round's day. And a round whose days an admin set (set_round_dates: a final on
-- a Friday, say) keeps its matches within them: such a round is now marked
-- `fixed`. The days of the other rounds are only a plan from the draw.

alter table public.tournament_rounds
  add column fixed boolean not null default false;  -- an admin set its days: its matches stay within them

-- ---------------------------------------------------------------------------
-- Gives each match that's ready but has no time the first free slot: after
-- play has started, from now on (unless its round is fixed); at the draw, or
-- in a fixed round, in its round's days (from today on; past the round's last
-- day, the next weekdays). Returns how many got one. Same as 0027 otherwise.
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
begin
  if not exists (select 1 from public.tournaments where id = p_tournament and status = 'active' and size is not null) then
    return 0;
  end if;
  perform public.ensure_tournament_rounds(p_tournament);
  select public.match_slot(best_of) into len from public.tournaments where id = p_tournament;
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
     order by tm.round, tm.slot
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

-- ---------------------------------------------------------------------------
-- An admin setting a round's days fixes them (0018 otherwise).
-- ---------------------------------------------------------------------------

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
  update public.tournament_rounds set starts_on = p_starts, ends_on = p_ends, fixed = true
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
