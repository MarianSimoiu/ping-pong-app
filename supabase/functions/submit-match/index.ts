// Edge Function: submit-match
//
// The single authoritative path for recording a CASUAL 1v1 match and updating
// ratings. The caller submits their opponent and the per-game scores (from the
// caller's perspective: score_a = you, score_b = opponent). This function:
//   1. authenticates the caller and resolves their player row,
//   2. validates the games and the series winner,
//   3. applies the repeat-opponent guard (inactivity decay is handled in engine),
//   4. runs the Glicko-2 update for both players (server-side, tested math),
//   5. persists match + games + rating_events + updated ratings atomically.
//
// Ratings are never computed or written by clients.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { resolveMatch, type RawGame } from '../_shared/match.ts';
import { repeatFactor } from '../_shared/glicko2.ts';
import { computeRatingUpdate, roundRating, type RatingRow } from '../_shared/engine.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

type Body = { opponentId?: string; bestOf?: number; games?: RawGame[] };

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
    const { opponentId, bestOf = 3, games = [] } = body;
    if (!opponentId) return jsonResponse({ error: 'opponentId is required' }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: me, error: meErr } = await admin
      .from('players')
      .select('id')
      .eq('user_id', userData.user.id)
      .single();
    if (meErr || !me) return jsonResponse({ error: 'Player profile not found' }, 404);
    if (opponentId === me.id) return jsonResponse({ error: 'You cannot play yourself' }, 400);

    const { data: opponent, error: oppErr } = await admin
      .from('players')
      .select('id')
      .eq('id', opponentId)
      .single();
    if (oppErr || !opponent) return jsonResponse({ error: 'Opponent not found' }, 404);

    let outcome;
    try {
      outcome = resolveMatch(bestOf, games);
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : 'Invalid match' }, 400);
    }
    const aWon = outcome.winner === 'a';
    const winnerId = aWon ? me.id : opponent.id;

    const { data: ratingRows, error: rErr } = await admin
      .from('player_ratings')
      .select('*')
      .in('player_id', [me.id, opponent.id]);
    if (rErr || !ratingRows || ratingRows.length !== 2) {
      return jsonResponse({ error: 'Could not load ratings' }, 500);
    }
    const aRow = ratingRows.find((r) => r.player_id === me.id) as RatingRow;
    const bRow = ratingRows.find((r) => r.player_id === opponent.id) as RatingRow;

    // Repeat-opponent guard: count today's prior H2H games between the pair.
    const since = new Date(Date.now() - DAY_MS).toISOString();
    const { count: priorToday } = await admin
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .gte('played_at', since)
      .or(
        `and(player_a.eq.${me.id},player_b.eq.${opponent.id}),` +
          `and(player_a.eq.${opponent.id},player_b.eq.${me.id})`,
      );
    const factor = repeatFactor(priorToday ?? 0);

    const now = new Date();
    const update = computeRatingUpdate({ aRow, bRow, aWon, factor, now });

    const payload = {
      match: {
        context: 'casual',
        player_a: me.id,
        player_b: opponent.id,
        winner_id: winnerId,
        best_of: bestOf,
        played_at: update.playedAt,
        created_by: me.id,
      },
      games: outcome.games.map((g) => ({ game_no: g.game_no, score_a: g.score_a, score_b: g.score_b })),
      events: update.events,
      ratings: update.ratings,
    };

    const { data: matchId, error: applyErr } = await admin.rpc('apply_rated_match', { payload });
    if (applyErr) return jsonResponse({ error: applyErr.message }, 500);

    return jsonResponse({
      matchId,
      repeatFactor: factor,
      you: { before: roundRating(update.aBefore), after: roundRating(update.aAfter) },
      opponent: { before: roundRating(update.bBefore), after: roundRating(update.bAfter) },
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
