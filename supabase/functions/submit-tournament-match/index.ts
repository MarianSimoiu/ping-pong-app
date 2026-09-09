// Edge Function: submit-tournament-match
//
// Records the result of a ready bracket node. Scores are entered from player_a's
// perspective (the bracket fixes who is A and B). Runs the SAME Glicko-2 update
// as casual play (repeat-opponent factor is always 1 for tournaments), then
// completes the node and advances the winner via apply_tournament_result.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { resolveMatch, type RawGame } from '../_shared/match.ts';
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
      .select('id')
      .eq('user_id', userData.user.id)
      .single();
    if (callerErr || !caller) return jsonResponse({ error: 'Player profile not found' }, 404);

    // Load the bracket node and its tournament.
    const { data: node, error: nodeErr } = await admin
      .from('tournament_matches')
      .select('id, round, slot, player_a, player_b, status, tournament:tournaments(id, size, best_of, created_by)')
      .eq('id', tournamentMatchId)
      .single();
    if (nodeErr || !node) return jsonResponse({ error: 'Tournament match not found' }, 404);

    const tournament = Array.isArray(node.tournament) ? node.tournament[0] : node.tournament;
    if (node.status === 'completed') return jsonResponse({ error: 'This match is already recorded' }, 400);
    if (node.status !== 'ready' || !node.player_a || !node.player_b) {
      return jsonResponse({ error: 'This match is not ready to be played yet' }, 400);
    }

    // Only the two players or the organizer may record the result.
    const allowed = [node.player_a, node.player_b, tournament.created_by];
    if (!allowed.includes(caller.id)) {
      return jsonResponse({ error: 'Only the players or the organizer can record this match' }, 403);
    }

    let outcome;
    try {
      outcome = resolveMatch(tournament.best_of, games);
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : 'Invalid match' }, 400);
    }
    const aWon = outcome.winner === 'a';
    const winnerId = aWon ? node.player_a : node.player_b;

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
    const totalRounds = Math.log2(tournament.size);

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
      games: outcome.games.map((g) => ({ game_no: g.game_no, score_a: g.score_a, score_b: g.score_b })),
      events: update.events,
      ratings: update.ratings,
      tournament_match_id: tournamentMatchId,
      total_rounds: totalRounds,
    };

    const { data: matchId, error: applyErr } = await admin.rpc('apply_tournament_result', { payload });
    if (applyErr) return jsonResponse({ error: applyErr.message }, 500);

    return jsonResponse({
      matchId,
      winnerId,
      playerA: { before: roundRating(update.aBefore), after: roundRating(update.aAfter) },
      playerB: { before: roundRating(update.bBefore), after: roundRating(update.bAfter) },
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
