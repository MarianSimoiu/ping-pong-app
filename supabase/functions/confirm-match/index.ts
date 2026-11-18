// Edge Function: confirm-match
//
// The opponent confirms or declines a pending match. Only the participant who
// did NOT submit it may act. On confirm, ratings are computed NOW (using
// current values + the repeat-opponent guard) and applied atomically; on
// decline, the match is marked rejected and never affects ratings. Either way
// the player who recorded it gets a push notification.
//
// A tournament result (migration 0028: one player recorded it) goes the same
// way, with the tournament's rules: no repeat-opponent damping, and on
// confirm the bracket moves on (confirm_tournament_result), the winner's next
// match gets its time and, after the final, season points are awarded. On
// decline the match is still to be recorded (reject_match frees it).

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { repeatFactor } from '../_shared/glicko2.ts';
import { computeRatingUpdate, roundRating, type RatingRow } from '../_shared/engine.ts';
import {
  gamesWon,
  singlesConfirmed,
  singlesDeclined,
  tournamentResultConfirmed,
  tournamentResultDeclined,
} from '../_shared/messages.ts';
import { afterResponse, notifyPlayers } from '../_shared/notify.ts';
import { announceRewards } from '../_shared/rewards.ts';
import { matchName } from '../_shared/rounds.ts';
import { announceSchedules } from '../_shared/schedule.ts';
import { awardSeasonPoints } from '../_shared/season.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

type Body = { matchId?: string; action?: 'confirm' | 'decline' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await asUser.auth.getUser();
    if (userErr || !userData.user) return jsonResponse({ error: 'Not authenticated' }, 401);

    const body = (await req.json()) as Body;
    const { matchId, action = 'confirm' } = body;
    if (!matchId) return jsonResponse({ error: 'matchId is required' }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: caller, error: callerErr } = await admin
      .from('players')
      .select('id, display_name')
      .eq('user_id', userData.user.id)
      .single();
    if (callerErr || !caller) return jsonResponse({ error: 'Player profile not found' }, 404);

    const { data: match, error: mErr } = await admin
      .from('matches')
      .select('id, player_a, player_b, winner_id, best_of, created_by, status, context, tournament_id, round')
      .eq('id', matchId)
      .single();
    if (mErr || !match) return jsonResponse({ error: 'Match not found' }, 404);
    if (match.status !== 'pending') return jsonResponse({ error: 'This match is no longer pending' }, 400);

    const isParticipant = caller.id === match.player_a || caller.id === match.player_b;
    if (!isParticipant) return jsonResponse({ error: 'You are not in this match' }, 403);
    if (caller.id === match.created_by) {
      return jsonResponse({ error: 'Your opponent must confirm the match you submitted' }, 403);
    }

    // The result as the player who recorded it sees it, for their notification.
    const { data: gameRows } = await admin.from('match_games').select('score_a, score_b').eq('match_id', matchId);
    const games = gamesWon(gameRows ?? []);
    const submitterIsA = match.created_by === match.player_a;
    const submitterResult = {
      matchId,
      opponent: caller.display_name,
      youWon: match.winner_id === match.created_by,
      yourGames: submitterIsA ? games.a : games.b,
      theirGames: submitterIsA ? games.b : games.a,
    };

    // A tournament result: which tournament and match, for the messages.
    const inTournament = match.context === 'tournament' && !!match.tournament_id;
    let tournament: { id: string; name: string; size: number } | null = null;
    let slot = 0;
    if (inTournament) {
      const [{ data: t, error: tErr }, { data: bracketMatch }] = await Promise.all([
        admin.from('tournaments').select('id, name, size').eq('id', match.tournament_id).single(),
        // The bracket match waiting on this result: the final and the
        // third-place match share the last round (0030).
        admin.from('tournament_matches').select('slot').eq('pending_match_id', matchId).maybeSingle(),
      ]);
      if (tErr || !t) return jsonResponse({ error: 'Tournament not found' }, 404);
      tournament = t;
      slot = bracketMatch?.slot ?? 0;
    }
    const tournamentResult = tournament && {
      ...submitterResult,
      tournamentId: tournament.id,
      tournament: tournament.name,
      match: matchName(match.round ?? 1, Math.log2(tournament.size), slot),
    };

    if (action === 'decline') {
      const { error: rejErr } = await admin.rpc('reject_match', { match_id: matchId });
      if (rejErr) return jsonResponse({ error: rejErr.message }, 500);
      await afterResponse(
        notifyPlayers(
          admin,
          [match.created_by],
          tournamentResult ? tournamentResultDeclined(tournamentResult) : singlesDeclined(submitterResult),
        ),
      );
      return jsonResponse({ status: 'rejected' });
    }

    // Confirm: compute and apply the rating update now.
    const { data: ratingRows, error: rErr } = await admin
      .from('player_ratings')
      .select('*')
      .in('player_id', [match.player_a, match.player_b]);
    if (rErr || !ratingRows || ratingRows.length !== 2) {
      return jsonResponse({ error: 'Could not load ratings' }, 500);
    }
    const aRow = ratingRows.find((r) => r.player_id === match.player_a) as RatingRow;
    const bRow = ratingRows.find((r) => r.player_id === match.player_b) as RatingRow;

    // Repeat-opponent guard: confirmed H2H games between the pair in the last
    // 24h. Tournament matches always count in full.
    let factor = 1;
    if (!tournament) {
      const since = new Date(Date.now() - DAY_MS).toISOString();
      const { count: priorToday } = await admin
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'confirmed')
        .gte('played_at', since)
        .or(
          `and(player_a.eq.${match.player_a},player_b.eq.${match.player_b}),` +
            `and(player_a.eq.${match.player_b},player_b.eq.${match.player_a})`,
        );
      factor = repeatFactor(priorToday ?? 0);
    }

    const aWon = match.winner_id === match.player_a;
    const update = computeRatingUpdate({ aRow, bRow, aWon, factor, now: new Date() });

    // A tournament result also completes the bracket match and moves the winner on.
    const { error: confirmErr } = await admin.rpc(tournament ? 'confirm_tournament_result' : 'confirm_match', {
      payload: { match_id: matchId, events: update.events, ratings: update.ratings },
    });
    if (confirmErr) return jsonResponse({ error: confirmErr.message }, 500);

    const submitterBefore = submitterIsA ? update.aBefore : update.bBefore;
    const submitterAfter = submitterIsA ? update.aAfter : update.bAfter;
    const change = {
      delta: Math.round(submitterAfter.rating - submitterBefore.rating),
      rating: Math.round(submitterAfter.rating),
    };
    await afterResponse(
      notifyPlayers(
        admin,
        [match.created_by],
        tournamentResult
          ? tournamentResultConfirmed({ ...tournamentResult, ...change })
          : singlesConfirmed({ ...submitterResult, ...change }),
      ),
    );
    // A tier promotion for either player.
    await afterResponse(announceRewards(admin, [match.player_a, match.player_b]));
    if (tournament) {
      // The winner's next match time; season points if that was the final.
      await afterResponse(announceSchedules(admin, tournament.id));
      await awardSeasonPoints(admin, tournament.id);
    }

    // The caller is always the confirming (non-submitting) participant, but
    // may be either side of the match — surface their own before/after and
    // delta directly so the client doesn't need to figure out which side it is.
    const callerIsA = caller.id === match.player_a;
    const callerBefore = callerIsA ? update.aBefore : update.bBefore;
    const callerAfter = callerIsA ? update.aAfter : update.bAfter;

    return jsonResponse({
      status: 'confirmed',
      repeatFactor: factor,
      you: {
        delta: Math.round(callerAfter.rating - callerBefore.rating),
        rating: Math.round(callerAfter.rating),
        rd: Math.round(callerAfter.rd),
      },
      playerA: { before: roundRating(update.aBefore), after: roundRating(update.aAfter) },
      playerB: { before: roundRating(update.bBefore), after: roundRating(update.bAfter) },
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
