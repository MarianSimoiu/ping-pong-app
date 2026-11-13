-- 0022_unanswered_matches.sql
-- How many matches are waiting on each player's answer (confirm or decline),
-- shown next to their name on the leaderboard:
--   * singles: a pending match they're in but didn't record (as
--     confirm-match allows: either player except the one who recorded it);
--   * doubles: a pending match the other team recorded. Either of the two
--     opponents can answer it, so it counts for both until one of them does.
-- Players with nothing waiting have no row. Read-only, like the other views.

create view public.unanswered_matches
with (security_invoker = true)
as
select waiting.player_id, count(*)::int as matches
  from (
    select p.player_id
      from public.matches m
     cross join lateral (values (m.player_a), (m.player_b)) p(player_id)
     where m.status = 'pending'
       and p.player_id is distinct from m.created_by
    union all
    select p.player_id
      from public.doubles_matches d
      join public.teams t on t.id = d.team_b
     cross join lateral (values (t.player_low), (t.player_high)) p(player_id)
     where d.status = 'pending'
  ) waiting
 where waiting.player_id is not null
 group by waiting.player_id;

revoke all on public.unanswered_matches from anon, authenticated;
grant select on public.unanswered_matches to authenticated, service_role;
