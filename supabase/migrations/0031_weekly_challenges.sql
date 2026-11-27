-- 0031_weekly_challenges.sql
-- Weekly challenges (docs/RATING.md §6). A player who switches them on (on
-- Home or in Settings) gets 3 opponents every week, Monday to Sunday in club
-- time, picked to spread their games around: the players they've played least
-- in the last 3 months, not last week's, other challenge players first, within
-- about 300 rating points, and only active ones (3+ matches, and a match in
-- the last 30 days unless they take part in challenges too).
--
-- The two play a challenge match, best of 3 or best of 5 as they agree. If it
-- was the winner's challenge, their rating gain is boosted: their 1st
-- challenge win of the week by 25%, the 2nd by 50%, the 3rd doubles it
-- (confirm-match works out the numbers; this stores them). A loss counts as
-- usual, and a challenge left unplayed costs nothing.
--
-- An hourly job makes the week's challenges and has the challenge-notices
-- Edge Function tell players theirs (Monday from 09:00) and remind them of the
-- ones still open (Thursday from 10:00).

-- ---------------------------------------------------------------------------
-- Weeks: Monday to Sunday, club time
-- ---------------------------------------------------------------------------

create or replace function public.club_week_start(d date default public.club_today())
returns date
language sql
stable
as $$
  select d - (extract(isodow from d)::int - 1)
$$;

grant execute on function public.club_week_start(date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Who has challenges switched on, and from which week (a Monday).
create table public.challenge_players (
  player_id  uuid primary key references public.players (id) on delete cascade,
  starts_on  date not null,
  joined_at  timestamptz not null default now()
);

-- A player's week of challenges, and the notifications sent about it.
create table public.challenge_weeks (
  week_start    date not null,
  player_id     uuid not null references public.players (id) on delete cascade,
  created_at    timestamptz not null default now(),
  announced_at  timestamptz,  -- "your challenges this week"
  reminded_at   timestamptz,  -- "2 challenges left this week"
  primary key (week_start, player_id)
);

-- One challenge: player_id's, against opponent_id, that week. When both take
-- part and were paired together, each has their own row: the match settles
-- both. The first challenge match the two play that week settles it.
create table public.challenges (
  id           uuid primary key default gen_random_uuid(),
  week_start   date not null,
  player_id    uuid not null references public.players (id) on delete cascade,
  opponent_id  uuid not null references public.players (id) on delete cascade,
  created_at   timestamptz not null default now(),
  result       text check (result in ('won', 'lost')),
  multiplier   double precision,  -- the boost a win earned: 1.25, 1.5 or 2
  match_id     uuid references public.matches (id) on delete set null,
  settled_at   timestamptz,
  unique (week_start, player_id, opponent_id),
  foreign key (week_start, player_id) references public.challenge_weeks (week_start, player_id) on delete cascade,
  constraint challenge_not_yourself check (player_id <> opponent_id)
);

create index challenges_opponent_idx on public.challenges (week_start, opponent_id);

-- A match recorded as a challenge match (best_of is then 3 or 5).
alter table public.matches add column challenge boolean not null default false;
-- The boost on a challenge win's rating change (null: none).
alter table public.rating_events add column challenge_multiplier double precision;

alter table public.challenge_players enable row level security;
alter table public.challenge_weeks enable row level security;
alter table public.challenges enable row level security;
create policy "challenge players readable by authenticated"
  on public.challenge_players for select to authenticated using (true);
create policy "challenge weeks readable by authenticated"
  on public.challenge_weeks for select to authenticated using (true);
create policy "challenges readable by authenticated"
  on public.challenges for select to authenticated using (true);
revoke all on public.challenge_players, public.challenge_weeks, public.challenges from anon, authenticated;
grant select on public.challenge_players, public.challenge_weeks, public.challenges to authenticated;
grant select, insert, update, delete on public.challenge_players, public.challenge_weeks, public.challenges to service_role;

-- ---------------------------------------------------------------------------
-- Picking opponents
-- ---------------------------------------------------------------------------

-- Who can be someone's challenge: 3+ matches, and a match in the last 30
-- days, unless they take part in challenges that week (then they mean to play).
create or replace function public.challenge_ready(p_week date, p_player uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.player_ratings r
     where r.player_id = p_player
       and r.matches_played >= 3
       and (r.last_played_at > now() - interval '30 days'
            or exists (select 1 from public.challenge_weeks w where w.week_start = p_week and w.player_id = p_player))
  )
$$;

-- How many more challenges a player's week needs (3 in all).
create or replace function public.challenges_needed(p_week date, p_player uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, 3 - count(*)::int)
    from public.challenges c
   where c.week_start = p_week and c.player_id = p_player
$$;

-- Whether two players already have a challenge between them that week.
create or replace function public.challenge_paired(p_week date, p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.challenges c
     where c.week_start = p_week
       and ((c.player_id = p_a and c.opponent_id = p_b) or (c.player_id = p_b and c.opponent_id = p_a))
  )
$$;

-- How poor a pick b is for a (lower is better): mostly how often they've
-- played each other in the last 3 months; last week's opponents only if
-- nobody else will do; more than 300 rating points apart counts against them
-- (100 points over is like one more recent match). Ties go at random.
create or replace function public.challenge_cost(p_week date, p_a uuid, p_b uuid)
returns double precision
language sql
volatile
security definer
set search_path = public
as $$
  select 10 * (select count(*) from public.matches m
                where m.status = 'confirmed' and m.played_at > now() - interval '90 days'
                  and ((m.player_a = p_a and m.player_b = p_b) or (m.player_a = p_b and m.player_b = p_a)))
       + case when exists (select 1 from public.challenges c
                            where c.week_start = p_week - 7
                              and ((c.player_id = p_a and c.opponent_id = p_b) or (c.player_id = p_b and c.opponent_id = p_a)))
              then 1000 else 0 end
       + greatest(0, abs(coalesce(ra.rating, 1500) - coalesce(rb.rating, 1500)) - 300) / 10
       + random()
    from (select 1) one
    left join public.player_ratings ra on ra.player_id = p_a
    left join public.player_ratings rb on rb.player_id = p_b
$$;

-- Makes the week's challenges for everyone taking part who has fewer than 3.
-- Safe to run again: it only fills what's missing (the hourly job runs it all
-- week, so a player short on Monday can still get an opponent who turns up).
-- Returns how many challenges it made.
--
-- Every possible pick for everyone still short, best first, taken while it
-- fits. A pick who takes part that week too and is short as well gets the
-- challenge as theirs too (both ready players; such a pick is preferred, by
-- half a recent match). Otherwise it's only the picker's, and while others
-- are free nobody is someone else's pick more than 4 times a week.
create or replace function public.make_challenges(p_week date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  made  integer := 0;
  cap   integer;
  e     record;
begin
  -- One run at a time: the hourly job, and someone joining mid-week.
  perform pg_advisory_xact_lock(hashtext('make_challenges'));

  -- Everyone taking part this week gets their week.
  insert into public.challenge_weeks (week_start, player_id)
  select p_week, cp.player_id from public.challenge_players cp where cp.starts_on <= p_week
  on conflict do nothing;

  foreach cap in array array[4, 1000000]
  loop
    for e in
      select x.a, x.b, x.both_in
        from (
          select w.player_id as a, r.player_id as b,
                 (o.player_id is not null and public.challenge_ready(p_week, w.player_id)) as both_in
            from public.challenge_weeks w
            join public.player_ratings r on r.player_id <> w.player_id
            left join public.challenge_weeks o on o.week_start = p_week and o.player_id = r.player_id
           where w.week_start = p_week
             and public.challenges_needed(p_week, w.player_id) > 0
             and public.challenge_ready(p_week, r.player_id)
             and not public.challenge_paired(p_week, w.player_id, r.player_id)
        ) x
       order by public.challenge_cost(p_week, x.a, x.b) - case when x.both_in then 5 else 0 end
    loop
      continue when public.challenges_needed(p_week, e.a) = 0
                 or public.challenge_paired(p_week, e.a, e.b);
      if e.both_in and public.challenges_needed(p_week, e.b) > 0 then
        insert into public.challenges (week_start, player_id, opponent_id)
        values (p_week, e.a, e.b), (p_week, e.b, e.a);
        made := made + 2;
      elsif (select count(*) from public.challenges c where c.week_start = p_week and c.opponent_id = e.b) < cap then
        insert into public.challenges (week_start, player_id, opponent_id) values (p_week, e.a, e.b);
        made := made + 1;
      end if;
    end loop;
  end loop;

  return made;
end;
$$;

-- ---------------------------------------------------------------------------
-- The switch (the challenge-settings Edge Function, for the signed-in player)
-- ---------------------------------------------------------------------------

-- On: from this week if asked and there's still time to play three matches
-- (until Wednesday), else from next Monday; this week's challenges are made
-- straight away. Off: no more weeks; this week's still count if played.
-- Returns the first week they take part in (null when off).
create or replace function public.set_challenges(p_player uuid, p_on boolean, p_this_week boolean default false)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  today      date := public.club_today();
  this_week  date := public.club_week_start(today);
  start      date;
begin
  if not p_on then
    delete from public.challenge_players where player_id = p_player;
    return null;
  end if;

  start := case when p_this_week and extract(isodow from today) <= 3 then this_week else this_week + 7 end;
  insert into public.challenge_players (player_id, starts_on) values (p_player, start)
  on conflict (player_id) do update
    set starts_on = least(public.challenge_players.starts_on, excluded.starts_on);
  select cp.starts_on into start from public.challenge_players cp where cp.player_id = p_player;

  if start <= this_week then
    perform public.make_challenges(this_week);
    -- They're looking at them: no "your challenges this week" for them.
    update public.challenge_weeks set announced_at = coalesce(announced_at, now())
     where week_start = this_week and player_id = p_player;
  end if;
  return start;
end;
$$;

-- ---------------------------------------------------------------------------
-- Challenge matches
-- ---------------------------------------------------------------------------

-- submit-match's insert, now with challenge matches: there has to be an open
-- challenge between the two that week, and no other challenge match of
-- theirs waiting to be confirmed.
create or replace function public.create_pending_match(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  m          jsonb := payload -> 'match';
  a          uuid := (m ->> 'player_a')::uuid;
  b          uuid := (m ->> 'player_b')::uuid;
  played     timestamptz := coalesce((m ->> 'played_at')::timestamptz, now());
  challenge  boolean := coalesce((m ->> 'challenge')::boolean, false);
  wk         date := public.club_week_start((played at time zone public.club_time_zone())::date);
  new_match  uuid;
  game       jsonb;
begin
  if challenge then
    if not exists (
      select 1 from public.challenges c
       where c.week_start = wk and c.result is null
         and ((c.player_id = a and c.opponent_id = b) or (c.player_id = b and c.opponent_id = a))
    ) then
      raise exception 'There''s no challenge between you two this week to play.';
    end if;
    if exists (
      select 1 from public.matches x
       where x.status = 'pending' and x.challenge
         and ((x.player_a = a and x.player_b = b) or (x.player_a = b and x.player_b = a))
         and public.club_week_start((x.played_at at time zone public.club_time_zone())::date) = wk
    ) then
      raise exception 'Your challenge match is already recorded: it''s waiting to be confirmed.';
    end if;
  end if;

  insert into public.matches (context, player_a, player_b, winner_id, best_of, played_at, created_by, status, challenge)
  values (
    'casual', a, b,
    (m ->> 'winner_id')::uuid,
    coalesce((m ->> 'best_of')::int, 3),
    played,
    (m ->> 'created_by')::uuid,
    'pending',
    challenge
  )
  returning id into new_match;

  for game in select * from jsonb_array_elements(payload -> 'games')
  loop
    insert into public.match_games (match_id, game_no, score_a, score_b)
    values (new_match, (game ->> 'game_no')::int, (game ->> 'score_a')::int, (game ->> 'score_b')::int);
  end loop;

  return new_match;
end;
$$;

-- The open challenges a pending challenge match settles when it's confirmed:
-- each player whose challenge it is, and how many challenges they've already
-- won that week (which sets the boost: 0 → 25%, 1 → 50%, 2 → double).
create or replace function public.match_challenges(p_match uuid)
returns table (player_id uuid, opponent_id uuid, wins_before integer)
language sql
stable
security definer
set search_path = public
as $$
  with m as (
    select x.player_a, x.player_b,
           public.club_week_start((x.played_at at time zone public.club_time_zone())::date) as wk
      from public.matches x
     where x.id = p_match and x.challenge and x.context = 'casual'
  )
  select c.player_id, c.opponent_id,
         (select count(*)::int from public.challenges w
           where w.week_start = c.week_start and w.player_id = c.player_id and w.result = 'won')
    from m
    join public.challenges c
      on c.week_start = m.wk and c.result is null
     and ((c.player_id = m.player_a and c.opponent_id = m.player_b)
       or (c.player_id = m.player_b and c.opponent_id = m.player_a))
$$;

-- 0005's confirm_match, which now also stores a challenge win's boost on its
-- rating event and settles the challenges the match was for (`challenges`:
-- player_id, opponent_id, result, multiplier). Each settles once: if one was
-- settled meanwhile, nothing is confirmed and confirm-match can try again.
create or replace function public.confirm_match(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  mid      uuid := (payload ->> 'match_id')::uuid;
  ev       jsonb;
  rr       jsonb;
  ch       jsonb;
  updated  int;
  wk       date;
begin
  update public.matches set status = 'confirmed', confirmed_at = now()
   where id = mid and status = 'pending';
  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'Match % is not pending', mid;
  end if;

  for ev in select * from jsonb_array_elements(payload -> 'events')
  loop
    insert into public.rating_events (
      match_id, player_id, opponent_id, result,
      rating_before, rd_before, volatility_before,
      rating_after, rd_after, volatility_after,
      delta, repeat_factor, provisional, challenge_multiplier)
    values (
      mid,
      (ev ->> 'player_id')::uuid,
      (ev ->> 'opponent_id')::uuid,
      ev ->> 'result',
      (ev ->> 'rating_before')::float8,
      (ev ->> 'rd_before')::float8,
      (ev ->> 'volatility_before')::float8,
      (ev ->> 'rating_after')::float8,
      (ev ->> 'rd_after')::float8,
      (ev ->> 'volatility_after')::float8,
      (ev ->> 'delta')::float8,
      coalesce((ev ->> 'repeat_factor')::float8, 1),
      coalesce((ev ->> 'provisional')::boolean, false),
      (ev ->> 'challenge_multiplier')::float8);
  end loop;

  for rr in select * from jsonb_array_elements(payload -> 'ratings')
  loop
    update public.player_ratings
       set rating         = (rr ->> 'rating')::float8,
           rd             = (rr ->> 'rd')::float8,
           volatility     = (rr ->> 'volatility')::float8,
           matches_played = matches_played + 1,
           last_played_at = coalesce((rr ->> 'played_at')::timestamptz, now()),
           updated_at     = now()
     where player_id = (rr ->> 'player_id')::uuid;
  end loop;

  select public.club_week_start((x.played_at at time zone public.club_time_zone())::date)
    into wk from public.matches x where x.id = mid;
  for ch in select * from jsonb_array_elements(coalesce(payload -> 'challenges', '[]'::jsonb))
  loop
    update public.challenges c
       set result = ch ->> 'result',
           multiplier = (ch ->> 'multiplier')::float8,
           match_id = mid,
           settled_at = now()
     where c.week_start = wk
       and c.player_id = (ch ->> 'player_id')::uuid
       and c.opponent_id = (ch ->> 'opponent_id')::uuid
       and c.result is null;
    get diagnostics updated = row_count;
    if updated = 0 then
      raise exception 'That challenge was settled meanwhile: try again.';
    end if;
  end loop;

  return mid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Notifications and the hourly job
-- ---------------------------------------------------------------------------

-- What's due at p_at, in club time and never after 21:00: "your challenges
-- this week" from 09:00 (Monday, or whenever someone's week was made), and
-- from Thursday 10:00 a reminder of the ones still open. Only to players who
-- still have challenges switched on.
create or replace function public.due_challenge_notices(p_at timestamptz default now())
returns table (player_id uuid, kind text)
language sql
stable
security definer
set search_path = public
as $$
  with clock as (
    select (p_at at time zone public.club_time_zone()) as t,
           public.club_week_start((p_at at time zone public.club_time_zone())::date) as wk
  )
  select w.player_id, 'announce'::text
    from public.challenge_weeks w, clock
   where w.week_start = clock.wk and w.announced_at is null
     and clock.t::time >= '09:00' and clock.t::time < '21:00'
     and exists (select 1 from public.challenge_players cp where cp.player_id = w.player_id)
     and exists (select 1 from public.challenges c where c.week_start = w.week_start and c.player_id = w.player_id)
  union all
  select w.player_id, 'remind'::text
    from public.challenge_weeks w, clock
   where w.week_start = clock.wk and w.announced_at is not null and w.reminded_at is null
     and extract(isodow from clock.t) >= 4 and clock.t::time >= '10:00' and clock.t::time < '21:00'
     and exists (select 1 from public.challenge_players cp where cp.player_id = w.player_id)
     and exists (select 1 from public.challenges c
                  where c.week_start = w.week_start and c.player_id = w.player_id and c.result is null)
$$;

-- Marks what's due as sent and returns it, each with the opponents to name
-- (for a reminder, the open ones), for the challenge-notices function. Two
-- calls at once can't both claim the same notice.
create or replace function public.claim_challenge_notices(p_at timestamptz default now())
returns table (player_id uuid, kind text, opponents text[])
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  wk date := public.club_week_start((p_at at time zone public.club_time_zone())::date);
begin
  return query
  with due as (
    select d.player_id, d.kind from public.due_challenge_notices(p_at) d
  ), announced as (
    update public.challenge_weeks w set announced_at = now()
      from due
     where due.kind = 'announce' and w.week_start = wk and w.player_id = due.player_id and w.announced_at is null
    returning w.player_id
  ), reminded as (
    update public.challenge_weeks w set reminded_at = now()
      from due
     where due.kind = 'remind' and w.week_start = wk and w.player_id = due.player_id and w.reminded_at is null
    returning w.player_id
  ), claimed as (
    select a.player_id, 'announce'::text as kind from announced a
    union all
    select r.player_id, 'remind'::text from reminded r
  )
  select cl.player_id, cl.kind,
         array(select p.display_name
                 from public.challenges x
                 join public.players p on p.id = x.opponent_id
                where x.week_start = wk and x.player_id = cl.player_id
                  and (cl.kind = 'announce' or x.result is null)
                order by x.created_at, p.display_name)
    from claimed cl;
end;
$$;

-- Every hour: make this week's challenges (only what's missing), and call
-- challenge-notices when something is due. The function URL is this
-- project's, as in 0013; it isn't a secret and the function takes no input.
create or replace function public.run_challenges()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.make_challenges(public.club_week_start());
  if exists (select 1 from public.due_challenge_notices()) then
    perform net.http_post(
      url := 'https://fdugzpsuznitvqwnrtim.supabase.co/functions/v1/challenge-notices',
      body := '{}'::jsonb,
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access: the Edge Functions call these, as the service role.
-- ---------------------------------------------------------------------------

revoke all on function public.challenge_ready(date, uuid),
  public.challenges_needed(date, uuid),
  public.challenge_paired(date, uuid, uuid),
  public.challenge_cost(date, uuid, uuid),
  public.make_challenges(date),
  public.set_challenges(uuid, boolean, boolean),
  public.create_pending_match(jsonb),
  public.match_challenges(uuid),
  public.confirm_match(jsonb),
  public.due_challenge_notices(timestamptz),
  public.claim_challenge_notices(timestamptz),
  public.run_challenges()
  from public, anon, authenticated;
grant execute on function public.make_challenges(date),
  public.set_challenges(uuid, boolean, boolean),
  public.create_pending_match(jsonb),
  public.match_challenges(uuid),
  public.confirm_match(jsonb),
  public.due_challenge_notices(timestamptz),
  public.claim_challenge_notices(timestamptz)
  to service_role;

do $$
begin
  perform cron.schedule('weekly-challenges', '7 * * * *', 'select public.run_challenges()');
exception when others then
  raise warning 'Weekly challenges won''t be made on their own until pg_cron is on (%). See 0031_weekly_challenges.sql.', sqlerrm;
end;
$$;
