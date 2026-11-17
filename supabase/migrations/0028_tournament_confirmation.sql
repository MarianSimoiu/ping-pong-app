-- 0028_tournament_confirmation.sql
-- A tournament result counts once both players agree on it, as a casual match
-- does (0005). When one of the two players records it, it waits as a pending
-- match (context 'tournament') until the other confirms it; then the rating
-- update, the bracket and the next match's time all follow as before. If the
-- other declines it, it's thrown out and the match is still to be recorded.
-- A result the organizer or an admin records (not as one of the two players)
-- counts straight away, as before, and replaces one still waiting; so does a
-- walkover. The Edge Functions (submit-tournament-match, confirm-match) decide
-- which path a result takes and call these as the service role.

alter table public.tournament_matches
  add column pending_match_id uuid references public.matches (id) on delete set null;  -- a result waiting for the other player

create index tournament_matches_pending_idx on public.tournament_matches (pending_match_id)
  where pending_match_id is not null;

-- ---------------------------------------------------------------------------
-- The winner of a finished bracket match goes on to their next match (ready
-- once both its players are known, when it gets its time: 0018), or the final
-- finishes the tournament. Returns true when it did.
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
    update public.tournament_matches set status = 'ready'
     where tournament_id = p_tournament and round = p_round + 1 and slot = p_slot / 2
       and player_a is not null and player_b is not null and status = 'pending';
    return false;
  end if;
  update public.tournaments set status = 'completed', end_date = now() where id = p_tournament;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- One of the two players records the result: stored, waiting for the other.
-- payload: { tournament_match_id, match: { winner_id, best_of, played_at,
-- created_by }, games: [{ game_no, score_a, score_b }] } (side a is the
-- bracket's player_a, as always).
-- ---------------------------------------------------------------------------

create or replace function public.record_tournament_result(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  m         jsonb := payload -> 'match';
  recorder  uuid := (m ->> 'created_by')::uuid;
  winner    uuid := (m ->> 'winner_id')::uuid;
  node      public.tournament_matches%rowtype;
  new_match uuid;
  game      jsonb;
begin
  select * into node from public.tournament_matches
   where id = (payload ->> 'tournament_match_id')::uuid
   for update;
  if not found then
    raise exception 'Tournament match not found';
  end if;
  if node.status <> 'ready' or node.player_a is null or node.player_b is null then
    raise exception 'This match is not ready to be played yet';
  end if;
  if node.pending_match_id is not null then
    raise exception 'A result for this match is already waiting to be confirmed';
  end if;
  if recorder is null or recorder not in (node.player_a, node.player_b) then
    raise exception 'Only one of the two players records a result for the other to confirm';
  end if;
  if winner is null or winner not in (node.player_a, node.player_b) then
    raise exception 'The winner has to be one of the two players';
  end if;

  insert into public.matches (context, tournament_id, round, player_a, player_b, winner_id, best_of, played_at, created_by, status)
  values ('tournament', node.tournament_id, node.round, node.player_a, node.player_b, winner,
          coalesce((m ->> 'best_of')::int, 3), coalesce((m ->> 'played_at')::timestamptz, now()), recorder, 'pending')
  returning id into new_match;

  for game in select * from jsonb_array_elements(payload -> 'games')
  loop
    insert into public.match_games (match_id, game_no, score_a, score_b)
    values (new_match, (game ->> 'game_no')::int, (game ->> 'score_a')::int, (game ->> 'score_b')::int);
  end loop;

  -- It's been played: a time still being asked about doesn't matter now.
  update public.tournament_matches
     set pending_match_id = new_match, proposed_at = null, proposed_by = null
   where id = node.id;
  return new_match;
end;
$$;

-- ---------------------------------------------------------------------------
-- The other player confirms it: the rating update (confirm_match, with the
-- events and ratings the Edge Function computed), then the bracket goes on.
-- payload: { match_id, events, ratings }.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_tournament_result(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  mid    uuid := (payload ->> 'match_id')::uuid;
  node   public.tournament_matches%rowtype;
  winner uuid;
begin
  select * into node from public.tournament_matches where pending_match_id = mid for update;
  if not found or node.status <> 'ready' then
    raise exception 'This result is no longer waiting to be confirmed';
  end if;

  perform public.confirm_match(jsonb_build_object(
    'match_id', mid, 'events', payload -> 'events', 'ratings', payload -> 'ratings'));

  select m.winner_id into winner from public.matches m where m.id = mid;
  update public.tournament_matches
     set match_id = mid, winner_id = winner, status = 'completed', pending_match_id = null,
         proposed_at = null, proposed_by = null
   where id = node.id;
  perform public.advance_tournament_winner(node.tournament_id, node.round, node.slot, winner);
  return mid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Declining (the other player) also frees a tournament match: it's still to
-- be recorded. Unchanged for casual matches.
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
  update public.matches set status = 'rejected' where id = reject_match.match_id and status = 'pending';
  get diagnostics updated = row_count;
  update public.tournament_matches set pending_match_id = null where pending_match_id = reject_match.match_id;
  return updated > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- The organizer's (or an admin's) result counts straight away, as before, and
-- replaces one still waiting to be confirmed. Same payload as before.
-- ---------------------------------------------------------------------------

create or replace function public.apply_tournament_result(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tm_id     uuid := (payload ->> 'tournament_match_id')::uuid;
  winner    uuid := (payload -> 'match' ->> 'winner_id')::uuid;
  node      public.tournament_matches%rowtype;
  new_match uuid;
begin
  select * into node from public.tournament_matches where id = tm_id for update;
  if not found then
    raise exception 'Tournament match not found';
  end if;
  if node.status <> 'ready' or node.player_a is null or node.player_b is null then
    raise exception 'This match is not ready to be played yet';
  end if;
  if node.pending_match_id is not null then
    update public.matches set status = 'rejected' where id = node.pending_match_id and status = 'pending';
  end if;

  -- Match + games + rating events + updated ratings (shared logic).
  new_match := public.apply_rated_match(payload);

  update public.tournament_matches
     set match_id = new_match, winner_id = winner, status = 'completed', pending_match_id = null,
         proposed_at = null, proposed_by = null
   where id = tm_id;
  perform public.advance_tournament_winner(node.tournament_id, node.round, node.slot, winner);
  return new_match;
end;
$$;

-- ---------------------------------------------------------------------------
-- A walkover (0018) also throws out a result still waiting.
-- ---------------------------------------------------------------------------

create or replace function public.give_walkover(p_match uuid, p_admin uuid, p_winner uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.tournament_matches%rowtype;
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
  if m.pending_match_id is not null then
    update public.matches set status = 'rejected' where id = m.pending_match_id and status = 'pending';
  end if;

  update public.tournament_matches
     set winner_id = p_winner, status = 'completed', walkover = true, proposed_at = null, proposed_by = null,
         pending_match_id = null
   where id = p_match;
  return public.advance_tournament_winner(m.tournament_id, m.round, m.slot, p_winner);
end;
$$;

-- ---------------------------------------------------------------------------
-- Access: the Edge Functions call these as the service role. (Replaced
-- functions keep their grants.)
-- ---------------------------------------------------------------------------

revoke all on function public.advance_tournament_winner(uuid, integer, integer, uuid) from public, anon, authenticated;
revoke all on function public.record_tournament_result(jsonb) from public, anon, authenticated;
revoke all on function public.confirm_tournament_result(jsonb) from public, anon, authenticated;
grant execute on function public.record_tournament_result(jsonb) to service_role;
grant execute on function public.confirm_tournament_result(jsonb) to service_role;
