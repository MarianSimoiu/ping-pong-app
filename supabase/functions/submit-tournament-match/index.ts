// Edge Function: submit-tournament-match
//
// Records the result of a ready bracket node. Scores are entered from player_a's
// perspective (the bracket fixes who is A and B).
//
// A result counts once both players agree on it (migration 0028). When one of
// the two players records it, it's stored as pending and the other is asked to
// confirm it (confirm-match then runs the rating update and moves the bracket
// on). A result the organizer or an admin records, not as one of the players,
// counts straight away: the SAME Glicko-2 update as casual play (the
// repeat-opponent factor is always 1 for tournaments), then the node completes
// and the winner goes on via apply_tournament_result, replacing a result still
// waiting. The winner's next match gets its time in the database (0018); both
// its players are told.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { resolveMatch, type RawGame } from '../_shared/match.ts';
import { tournamentResultByOrganizer, tournamentResultToConfirm } from '../_shared/messages.ts';
import { afterResponse, notifyEach, notifyPlayers } from '../_shared/notify.ts';
import { announceRewards } from '../_shared/rewards.ts';
import { matchName } from '../_shared/rounds.ts';
import { announceSchedules } from '../_shared/schedule.ts';
import { awardSeasonPoints } from '../_shared/season.ts';
import { computeRatingUpdate, roundRating, type RatingRow } from '../_shared/engine.ts';

type Body = { tournamentMatchId?: string; games?: RawGame[] };

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
    const { tournamentMatchId, games = [] } = body;
    if (!tournamentMatchId) return jsonResponse({ error: 'tournamentMatchId is required' }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: caller, error: callerErr } = await admin
      .from('players')
      .select('id, display_name')
      .eq('user_id', userData.user.id)
      .single();
    if (callerErr || !caller) return jsonResponse({ error: 'Player profile not found' }, 404);

    // Load the bracket node and its tournament.
    const { data: node, error: nodeErr } = await admin
      .from('tournament_matches')
      // One string literal, so supabase-js can type the row.
      .select('id, round, slot, player_a, player_b, status, pending_match_id, tournament:tournaments(id, name, size, best_of, created_by)')
      .eq('id', tournamentMatchId)
      .single();
    if (nodeErr || !node) return jsonResponse({ error: 'Tournament match not found' }, 404);

    const tournament = Array.isArray(node.tournament) ? node.tournament[0] : node.tournament;
    if (node.status === 'completed') return jsonResponse({ error: 'This match is already recorded' }, 400);
    if (node.status !== 'ready' || !node.player_a || !node.player_b) {
      return jsonResponse({ error: 'This match is not ready to be played yet' }, 400);
    }

    // Only the two players, the organizer or an admin (who decides matches
    // not played on their day) may record the result.
    const isPlayer = caller.id === node.player_a || caller.id === node.player_b;
    if (!isPlayer && caller.id !== tournament.created_by) {
      const { data: adminRow, error: adminErr } = await admin
        .from('admins')
        .select('player_id')
        .eq('player_id', caller.id)
        .maybeSingle();
      if (adminErr) return jsonResponse({ error: adminErr.message }, 500);
      if (!adminRow) return jsonResponse({ error: 'Only the players or an organizer can record this match' }, 403);
    }
    if (isPlayer && node.pending_match_id) {
      return jsonResponse({ error: 'A result for this match is already waiting to be confirmed' }, 409);
    }

    let outcome;
    try {
      outcome = resolveMatch(tournament.best_of, games);
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : 'Invalid match' }, 400);
    }
    const aWon = outcome.winner === 'a';
    const winnerId = aWon ? node.player_a : node.player_b;
    const gameRows = outcome.games.map((g) => ({ game_no: g.game_no, score_a: g.score_a, score_b: g.score_b }));
    const totalRounds = Math.log2(tournament.size);
    const match = matchName(node.round, totalRounds, node.slot);

    const { data: names } = await admin
      .from('players')
      .select('id, display_name')
      .in('id', [node.player_a, node.player_b]);
    const nameOf = (id: string) => names?.find((p) => p.id === id)?.display_name ?? 'Your opponent';
    // The result from one side: games won, and whether they won.
    const sideOf = (id: string) => {
      const isA = id === node.player_a;
      return {
        youWon: winnerId === id,
        yourGames: isA ? outcome.aWins : outcome.bWins,
        theirGames: isA ? outcome.bWins : outcome.aWins,
      };
    };

    if (isPlayer) {
      // One of the players: it waits for the other to confirm it.
      const { data: matchId, error: recErr } = await admin.rpc('record_tournament_result', {
        payload: {
          tournament_match_id: tournamentMatchId,
          match: {
            winner_id: winnerId,
            best_of: tournament.best_of,
            played_at: new Date().toISOString(),
            created_by: caller.id,
          },
          games: gameRows,
        },
      });
      if (recErr) return jsonResponse({ error: recErr.message }, 400);
      const opponentId = caller.id === node.player_a ? node.player_b : node.player_a;
      await afterResponse(
        notifyPlayers(
          admin,
          [opponentId],
          tournamentResultToConfirm({
            tournamentId: tournament.id,
            tournament: tournament.name,
            match,
            matchId,
            recorder: caller.display_name,
            ...sideOf(opponentId),
          }),
        ),
      );
      return jsonResponse({ status: 'pending', matchId, winnerId, waitingFor: nameOf(opponentId) });
    }

    // The organizer or an admin: it counts now.
    const { data: ratingRows, error: rErr } = await admin
      .from('player_ratings')
      .select('*')
      .in('player_id', [node.player_a, node.player_b]);
    if (rErr || !ratingRows || ratingRows.length !== 2) {
      return jsonResponse({ error: 'Could not load ratings' }, 500);
    }
    const aRow = ratingRows.find((r) => r.player_id === node.player_a) as RatingRow;
    const bRow = ratingRows.find((r) => r.player_id === node.player_b) as RatingRow;

    const now = new Date();
    const update = computeRatingUpdate({ aRow, bRow, aWon, factor: 1, now });

    const payload = {
      match: {
        context: 'tournament',
        tournament_id: tournament.id,
        round: node.round,
        player_a: node.player_a,
        player_b: node.player_b,
        winner_id: winnerId,
        best_of: tournament.best_of,
        played_at: update.playedAt,
        created_by: caller.id,
      },
      games: gameRows,
      events: update.events,
      ratings: update.ratings,
      tournament_match_id: tournamentMatchId,
      total_rounds: totalRounds,
    };

    const { data: matchId, error: applyErr } = await admin.rpc('apply_tournament_result', { payload });
    if (applyErr) return jsonResponse({ error: applyErr.message }, 500);
    // Both players are told the result the organizer recorded.
    const told = (id: string, other: string) => ({
      playerId: id,
      message: tournamentResultByOrganizer({
        tournamentId: tournament.id,
        tournament: tournament.name,
        match,
        matchId,
        opponent: nameOf(other),
        ...sideOf(id),
      }),
    });
    await afterResponse(notifyEach(admin, [told(node.player_a, node.player_b), told(node.player_b, node.player_a)]));
    // A tier promotion for either player; the winner's next match time.
    await afterResponse(announceRewards(admin, [node.player_a, node.player_b]));
    await afterResponse(announceSchedules(admin, tournament.id));

    // If that result finished the tournament, award WTA-style season points.
    const seasonPointsAwarded = await awardSeasonPoints(admin, tournament.id);

    return jsonResponse({
      status: 'confirmed',
      seasonPointsAwarded,
      matchId,
      winnerId,
      playerA: { before: roundRating(update.aBefore), after: roundRating(update.aAfter) },
      playerB: { before: roundRating(update.bBefore), after: roundRating(update.bAfter) },
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
