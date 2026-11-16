-- 0027_match_lengths.sql
-- Shorter match slots, lined up back to back from 11:00.
--
-- How long a tournament match holds the one table (match_slot, from 0018):
-- 15 minutes for best of 1, 20 for best of 3, 25 for best of 5 and 30 for
-- best of 7 (was 30, 30, 45 and 60). The time is when a match is planned,
-- not an appointment: two players who are both ready earlier just play, if
-- the table's free.
--
-- schedule_tournament_matches tries start times 5 minutes apart (was 15), so
-- the matches follow each other with no gap: 11:00, 11:20, 11:40 at best of 3.
-- Matches that already have a time keep it; the ones scheduled from now on
-- get the new lengths.

create or replace function public.match_slot(best_of integer)
returns interval language sql immutable as $$
  select case when best_of <= 1 then interval '15 minutes'
              when best_of <= 3 then interval '20 minutes'
              when best_of <= 5 then interval '25 minutes'
              else interval '30 minutes' end
$$;

-- As in 0018, but stepping 5 minutes at a time.
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
