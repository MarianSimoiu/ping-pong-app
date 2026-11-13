-- 0021_tournament_podium.sql
-- The podium of every completed tournament, for the trophy and the medals:
-- the champion (place 1: the trophy), the runner-up (2: silver) and both
-- semifinal losers (3: bronze; there's no third-place match, like the table
-- tennis World Championships). A semifinal lost on a walkover still counts:
-- the player reached it. The app shows them on the tournament page and on
-- each player's Trophies tab.

create view public.tournament_podium
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
    join public.tournament_matches m on m.tournament_id = d.id and m.round = d.final_round
    cross join lateral (values (m.player_a), (m.player_b)) f(player_id)
   where f.player_id is not null and m.winner_id is not null
  union all
  -- The semifinals: both losers third (a bye isn't a semifinal).
  select d.id, case when m.winner_id = m.player_a then m.player_b else m.player_a end, 3
    from done d
    join public.tournament_matches m on m.tournament_id = d.id and m.round = d.final_round - 1
   where m.winner_id is not null and m.player_a is not null and m.player_b is not null
)
select p.tournament_id, d.name as tournament_name, d.at, p.place, p.player_id, pl.display_name
  from places p
  join done d on d.id = p.tournament_id
  join public.players pl on pl.id = p.player_id;

revoke all on public.tournament_podium from anon, authenticated;
grant select on public.tournament_podium to authenticated, service_role;
