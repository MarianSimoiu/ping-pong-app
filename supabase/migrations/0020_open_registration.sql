-- 0020_open_registration.sql
-- Everyone can register for a tournament: 0012's rule that only players on
-- the leaderboard (3+ confirmed matches) can is gone. A player with no rated
-- match yet counts as 1500 for the pots and the draw (the seeding and the
-- frozen rating_at_draw come from the pots, through kickoff.ts).

-- ---------------------------------------------------------------------------
-- The live pots: 0012's view, with 1500 for anyone who hasn't played.
-- ---------------------------------------------------------------------------

create or replace view public.tournament_live_pots
with (security_invoker = true)
as
select s.tournament_id,
       s.player_id,
       s.display_name,
       s.avatar_url,
       s.rating,
       s.registered_at,
       ntile(s.pot_count) over (
         partition by s.tournament_id
         order by s.rating desc, s.registered_at, s.player_id
       ) as pot
from (
  select tp.tournament_id,
         tp.player_id,
         pl.display_name,
         pl.avatar_url,
         case when coalesce(r.matches_played, 0) = 0 then 1500 else r.rating end as rating,
         tp.registered_at,
         case
           when count(*) over (partition by tp.tournament_id) >= 8 then 4
           when count(*) over (partition by tp.tournament_id) >= 2 then 2
           else 1
         end as pot_count
  from public.tournament_participants tp
  join public.tournaments t on t.id = tp.tournament_id and t.status = 'registration'
  join public.players pl on pl.id = tp.player_id
  left join public.player_ratings r on r.player_id = tp.player_id
) s;

-- ---------------------------------------------------------------------------
-- register_for_tournament: anyone, until kickoff (0012's, without the
-- matches check). Its grants stay as they were (service role only).
-- ---------------------------------------------------------------------------

create or replace function public.register_for_tournament(p_tournament uuid, p_player uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t      public.tournaments%rowtype;
  closed text;
begin
  -- Locking the tournament makes registrations wait for a draw in progress.
  select * into t from public.tournaments where id = p_tournament for update;
  if not found then
    raise exception 'Tournament not found';
  end if;
  closed := public.tournament_closed_reason(t);
  if closed is not null then
    raise exception '%', closed;
  end if;

  insert into public.tournament_participants (tournament_id, player_id)
  values (p_tournament, p_player)
  on conflict (tournament_id, player_id) do nothing;
end;
$$;
