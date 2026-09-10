-- 0005_match_confirmation.sql
-- Casual matches now require the OPPONENT to confirm before ratings apply. This
-- closes the fairness gap where one player could unilaterally log (fake) matches.
--
-- Flow: submitter creates a 'pending' match (stored, but no rating change). The
-- opponent confirms (ratings compute and apply at confirmation time) or declines
-- (match marked 'rejected'). Tournament matches are unaffected: they are written
-- directly as 'confirmed' by apply_rated_match (the new column defaults to it).

alter table public.matches
  add column status text not null default 'confirmed'
    check (status in ('pending', 'confirmed', 'rejected')),
  add column confirmed_at timestamptz;

-- Fast lookup of "matches awaiting confirmation".
create index matches_pending_idx on public.matches (status) where status = 'pending';

-- ---------------------------------------------------------------------------
-- create_pending_match: store the match + games only (no rating change yet).
-- ---------------------------------------------------------------------------

create or replace function public.create_pending_match(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  m         jsonb := payload -> 'match';
  new_match uuid;
  game      jsonb;
begin
  insert into public.matches (context, player_a, player_b, winner_id, best_of, played_at, created_by, status)
  values (
    'casual',
    (m ->> 'player_a')::uuid,
    (m ->> 'player_b')::uuid,
    (m ->> 'winner_id')::uuid,
    coalesce((m ->> 'best_of')::int, 3),
    coalesce((m ->> 'played_at')::timestamptz, now()),
    (m ->> 'created_by')::uuid,
    'pending'
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

-- ---------------------------------------------------------------------------
-- confirm_match: mark a pending match confirmed and apply the rating update
-- (events + player_ratings) atomically. Guards against double-confirming.
-- ---------------------------------------------------------------------------

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
  updated  int;
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
      delta, repeat_factor, provisional)
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
      coalesce((ev ->> 'provisional')::boolean, false));
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

  return mid;
end;
$$;

-- ---------------------------------------------------------------------------
-- reject_match: the opponent declines a pending match.
-- ---------------------------------------------------------------------------

create or replace function public.reject_match(match_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated int;
begin
  update public.matches set status = 'rejected' where id = match_id and status = 'pending';
  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

revoke all on function public.create_pending_match(jsonb) from public, anon, authenticated;
revoke all on function public.confirm_match(jsonb) from public, anon, authenticated;
revoke all on function public.reject_match(uuid) from public, anon, authenticated;
grant execute on function public.create_pending_match(jsonb) to service_role;
grant execute on function public.confirm_match(jsonb) to service_role;
grant execute on function public.reject_match(uuid) to service_role;
