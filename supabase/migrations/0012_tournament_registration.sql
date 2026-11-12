-- 0012_tournament_registration.sql
-- Tournaments with registration. An admin creates a tournament with a kickoff
-- time; until then, players on the leaderboard (3+ confirmed matches) register
-- or withdraw themselves. Registered players are split into pots by rating,
-- live, as people join. At kickoff the pots are frozen and the draw is made
-- (Pot 1 meets Pot 4, Pot 2 meets Pot 3 in round 1; top seeds get any byes),
-- then the bracket is played as before (0003). The draw itself is tested
-- TypeScript in the Edge Functions (_shared/draw.ts, _shared/bracket.ts); these
-- RPCs store it.
--
-- Also locks tournament creation to admins inside the database itself, not
-- only in the Edge Function, and leaves the app read-only access to the
-- tournament tables.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.tournaments
  add column kickoff_at timestamptz,
  alter column size drop not null;  -- known once the draw is made

alter table public.tournaments drop constraint tournaments_status_check;
alter table public.tournaments add constraint tournaments_status_check
  check (status in ('draft', 'registration', 'active', 'completed', 'cancelled'));
alter table public.tournaments add constraint tournaments_registration_kickoff_check
  check (status <> 'registration' or kickoff_at is not null);

alter table public.tournament_participants
  alter column seed drop not null,                       -- given by the draw
  add column pot integer check (pot between 1 and 4),    -- frozen by the draw
  add column rating_at_draw double precision,
  add column registered_at timestamptz not null default now();

-- Players in tournaments created before registration existed were "registered"
-- when the tournament was made.
update public.tournament_participants p
   set registered_at = t.created_at
  from public.tournaments t
 where t.id = p.tournament_id;

create index tournament_participants_player_idx on public.tournament_participants (player_id);

-- ---------------------------------------------------------------------------
-- Only admins can create tournaments: checked on every insert, whoever makes
-- it (an Edge Function, an RPC, or the SQL Editor).
-- ---------------------------------------------------------------------------

create or replace function public.tournament_creator_must_be_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.admins where player_id = new.created_by) then
    raise exception 'Only admins can create tournaments' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke all on function public.tournament_creator_must_be_admin() from public, anon, authenticated;

create trigger tournaments_creator_must_be_admin
  before insert or update of created_by on public.tournaments
  for each row execute function public.tournament_creator_must_be_admin();

-- The app only reads these tables; every change goes through the RPCs below,
-- called by Edge Functions with the service role. (They had Supabase's old
-- default grants; RLS already blocked writes, this removes them outright.)
revoke all on public.tournaments, public.tournament_participants, public.tournament_matches
  from anon, authenticated;
grant select on public.tournaments, public.tournament_participants, public.tournament_matches
  to authenticated;
grant select, insert, update, delete
  on public.tournaments, public.tournament_participants, public.tournament_matches
  to service_role;

-- The old create_tournament (bracket made from a hand-picked list) is replaced
-- by open_tournament + registration + kickoff_tournament.
drop function if exists public.create_tournament(jsonb);

-- ---------------------------------------------------------------------------
-- Live pots: the players registered for each tournament that is still open,
-- with the pot their rating puts them in right now. 4 pots from 8 players,
-- otherwise 2; pots are as equal as possible, bigger ones first. Ties go to
-- whoever registered first. The app shows this during registration and the
-- kickoff uses it for the draw, so both always agree.
-- ---------------------------------------------------------------------------

create view public.tournament_live_pots
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
         r.rating,
         tp.registered_at,
         case
           when count(*) over (partition by tp.tournament_id) >= 8 then 4
           when count(*) over (partition by tp.tournament_id) >= 2 then 2
           else 1
         end as pot_count
  from public.tournament_participants tp
  join public.tournaments t on t.id = tp.tournament_id and t.status = 'registration'
  join public.players pl on pl.id = tp.player_id
  join public.player_ratings r on r.player_id = tp.player_id
) s;

revoke all on public.tournament_live_pots from anon, authenticated;
grant select on public.tournament_live_pots to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RPCs (service role only, like every other write)
-- ---------------------------------------------------------------------------

-- open_tournament: an admin creates a tournament, open for registration until
-- its kickoff time. The trigger above rejects anyone who isn't an admin.
create or replace function public.open_tournament(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  kickoff timestamptz := (payload ->> 'kickoff_at')::timestamptz;
  new_id  uuid;
begin
  if kickoff is null or kickoff <= now() then
    raise exception 'Pick a kickoff time in the future';
  end if;
  insert into public.tournaments (name, format, tier, best_of, status, kickoff_at, start_date, created_by)
  values (
    payload ->> 'name',
    'single_elim',
    coalesce((payload ->> 'tier')::int, 1),
    coalesce((payload ->> 'best_of')::int, 3),
    'registration',
    kickoff,
    kickoff,
    (payload ->> 'created_by')::uuid
  )
  returning id into new_id;
  return new_id;
end;
$$;

-- Why a tournament no longer takes registrations or withdrawals (null if it
-- still does). Takes the row locked by the caller.
create or replace function public.tournament_closed_reason(t public.tournaments)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when t.status = 'cancelled' then 'This tournament was cancelled'
    when t.status <> 'registration' then 'This tournament has already started'
    when t.kickoff_at <= now() then 'Registration closed at kickoff'
  end
$$;

-- register_for_tournament: a player signs up. Only players on the leaderboard
-- (3+ confirmed matches, MIN_MATCHES_FOR_LEADERBOARD in the app) can.
create or replace function public.register_for_tournament(p_tournament uuid, p_player uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t       public.tournaments%rowtype;
  played  integer;
  closed  text;
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

  select matches_played into played from public.player_ratings where player_id = p_player;
  played := coalesce(played, 0);
  if played < 3 then
    raise exception 'Only players on the leaderboard can register: play % more match%',
      3 - played, case when 3 - played = 1 then '' else 'es' end;
  end if;

  insert into public.tournament_participants (tournament_id, player_id)
  values (p_tournament, p_player)
  on conflict (tournament_id, player_id) do nothing;
end;
$$;

-- withdraw_from_tournament: a player takes their registration back, any time
-- before kickoff.
create or replace function public.withdraw_from_tournament(p_tournament uuid, p_player uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t      public.tournaments%rowtype;
  closed text;
begin
  select * into t from public.tournaments where id = p_tournament for update;
  if not found then
    raise exception 'Tournament not found';
  end if;
  closed := public.tournament_closed_reason(t);
  if closed is not null then
    raise exception '%', closed;
  end if;
  delete from public.tournament_participants
   where tournament_id = p_tournament and player_id = p_player;
end;
$$;

-- kickoff_tournament: stores the draw (each player's frozen pot, rating and
-- seed, and the whole bracket) and starts the tournament. Without
-- `started_by` it's the automatic kickoff and the tournament must be due;
-- with it, an admin is starting it early. Returns false, changing nothing,
-- if the tournament isn't waiting to start (already started by another call,
-- or cancelled) or isn't due: the caller then sends no notifications.
create or replace function public.kickoff_tournament(payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  tid         uuid := (payload ->> 'tournament_id')::uuid;
  started_by  uuid := nullif(payload ->> 'started_by', '')::uuid;
  t           public.tournaments%rowtype;
  registered  integer;
  part        jsonb;
  node        jsonb;
begin
  select * into t from public.tournaments where id = tid for update;
  if not found or t.status <> 'registration' then
    return false;
  end if;
  if started_by is null and t.kickoff_at > now() then
    return false;
  end if;
  if started_by is not null
     and not exists (select 1 from public.admins where player_id = started_by) then
    raise exception 'Only admins can start a tournament early';
  end if;

  select count(*) into registered from public.tournament_participants where tournament_id = tid;
  if registered < 4 then
    raise exception 'A tournament needs at least 4 players to start';
  end if;
  -- The draw must cover exactly the players registered now (someone may have
  -- joined or withdrawn while it was being made: the caller draws again).
  if registered <> jsonb_array_length(payload -> 'participants')
     or exists (
       select 1 from public.tournament_participants tp
        where tp.tournament_id = tid
          and not exists (
            select 1 from jsonb_array_elements(payload -> 'participants') e
             where (e ->> 'player_id')::uuid = tp.player_id
          )
     )
  then
    raise exception 'Registrations changed during the draw' using errcode = 'serialization_failure';
  end if;

  for part in select * from jsonb_array_elements(payload -> 'participants')
  loop
    update public.tournament_participants
       set seed = (part ->> 'seed')::int,
           pot = (part ->> 'pot')::int,
           rating_at_draw = (part ->> 'rating')::double precision
     where tournament_id = tid and player_id = (part ->> 'player_id')::uuid;
  end loop;

  for node in select * from jsonb_array_elements(payload -> 'nodes')
  loop
    insert into public.tournament_matches (tournament_id, round, slot, player_a, player_b, winner_id, status)
    values (
      tid,
      (node ->> 'round')::int,
      (node ->> 'slot')::int,
      nullif(node ->> 'player_a', '')::uuid,
      nullif(node ->> 'player_b', '')::uuid,
      nullif(node ->> 'winner_id', '')::uuid,
      coalesce(node ->> 'status', 'pending')
    );
  end loop;

  update public.tournaments
     set status = 'active',
         size = (payload ->> 'size')::int,
         start_date = now(),
         kickoff_at = least(kickoff_at, now())
   where id = tid;
  return true;
end;
$$;

-- reschedule_tournament: an admin moves the kickoff (also how a tournament
-- that reached kickoff without enough players gets more time).
create or replace function public.reschedule_tournament(p_tournament uuid, p_admin uuid, p_kickoff_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tournaments%rowtype;
begin
  if not exists (select 1 from public.admins where player_id = p_admin) then
    raise exception 'Only admins can change a tournament';
  end if;
  select * into t from public.tournaments where id = p_tournament for update;
  if not found then
    raise exception 'Tournament not found';
  end if;
  if t.status <> 'registration' then
    raise exception 'Only a tournament that hasn''t started can be rescheduled';
  end if;
  if p_kickoff_at is null or p_kickoff_at <= now() then
    raise exception 'Pick a kickoff time in the future';
  end if;
  update public.tournaments set kickoff_at = p_kickoff_at, start_date = p_kickoff_at where id = p_tournament;
end;
$$;

-- cancel_tournament: an admin calls off a tournament before its draw. The
-- registrations stay, so it's clear who had signed up.
create or replace function public.cancel_tournament(p_tournament uuid, p_admin uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tournaments%rowtype;
begin
  if not exists (select 1 from public.admins where player_id = p_admin) then
    raise exception 'Only admins can change a tournament';
  end if;
  select * into t from public.tournaments where id = p_tournament for update;
  if not found then
    raise exception 'Tournament not found';
  end if;
  if t.status <> 'registration' then
    raise exception 'Only a tournament that hasn''t started can be cancelled';
  end if;
  update public.tournaments set status = 'cancelled', end_date = now() where id = p_tournament;
end;
$$;

revoke all on function public.open_tournament(jsonb) from public, anon, authenticated;
revoke all on function public.tournament_closed_reason(public.tournaments) from public, anon, authenticated;
revoke all on function public.register_for_tournament(uuid, uuid) from public, anon, authenticated;
revoke all on function public.withdraw_from_tournament(uuid, uuid) from public, anon, authenticated;
revoke all on function public.kickoff_tournament(jsonb) from public, anon, authenticated;
revoke all on function public.reschedule_tournament(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.cancel_tournament(uuid, uuid) from public, anon, authenticated;
grant execute on function public.open_tournament(jsonb) to service_role;
grant execute on function public.register_for_tournament(uuid, uuid) to service_role;
grant execute on function public.withdraw_from_tournament(uuid, uuid) to service_role;
grant execute on function public.kickoff_tournament(jsonb) to service_role;
grant execute on function public.reschedule_tournament(uuid, uuid, timestamptz) to service_role;
grant execute on function public.cancel_tournament(uuid, uuid) to service_role;
