// Edge Function: submit-match
//
// The single authoritative path for recording a 1v1 match and updating ratings.
// The caller submits their opponent and the per-game scores (from the caller's
// perspective: score_a = you, score_b = opponent). This function:
//   1. authenticates the caller and resolves their player row,
//   2. validates the games and the series winner,
//   3. applies inactivity/RD decay and the repeat-opponent guard,
//   4. runs the Glicko-2 update for both players (server-side, tested math),
//   5. persists match + games + rating_events + updated ratings atomically.
//
// Ratings are never computed or written by clients.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { resolveMatch, type RawGame } from '../_shared/match.ts';
import {
  applyInactivity,
  applyRepeatFactor,
  isProvisional,
  repeatFactor,
  updateRating,
  type Rating,
} from '../_shared/glicko2.ts';

// One Glicko-2 "rating period" for inactivity purposes. RD grows for idle time
// measured in these units (see docs/RATING.md §2.4).
const RATING_PERIOD_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

type Body = { opponentId?: string; bestOf?: number; games?: RawGame[] };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  try {
    // --- authenticate the caller ---------------------------------------------
    const authHeader = req.headers.get('Authorization') ?? '';
    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await asUser.auth.getUser();
    if (userErr || !userData.user) return jsonResponse({ error: 'Not authenticated' }, 401);

    const body = (await req.json()) as Body;
    const { opponentId, bestOf = 3, games = [] } = body;
    if (!opponentId) return jsonResponse({ error: 'opponentId is required' }, 400);

    // Service-role client for all reads/writes below.
    const admin = createClient(supabaseUrl, serviceKey);

    // --- resolve both players -------------------------------------------------
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

    // --- validate the match ---------------------------------------------------
    let outcome;
    try {
      outcome = resolveMatch(bestOf, games);
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : 'Invalid match' }, 400);
    }
    const aWon = outcome.winner === 'a';
    const winnerId = aWon ? me.id : opponent.id;

    // --- load current ratings -------------------------------------------------
    const { data: ratingRows, error: rErr } = await admin
      .from('player_ratings')
      .select('*')
      .in('player_id', [me.id, opponent.id]);
    if (rErr || !ratingRows || ratingRows.length !== 2) {
      return jsonResponse({ error: 'Could not load ratings' }, 500);
    }
    const rowFor = (id: string) => ratingRows.find((r) => r.player_id === id)!;
    const aRow = rowFor(me.id);
    const bRow = rowFor(opponent.id);

    // --- repeat-opponent guard: count today's prior H2H games -----------------
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

    // --- inactivity/RD decay, then the Glicko-2 update ------------------------
    const now = new Date();
    const decay = (row: typeof aRow): Rating => {
      const base: Rating = { rating: row.rating, rd: row.rd, volatility: row.volatility };
      if (!row.last_played_at) return base;
      const periods = Math.max(0, (now.getTime() - new Date(row.last_played_at).getTime()) / (RATING_PERIOD_DAYS * DAY_MS));
      return applyInactivity(base, periods);
    };

    const aBefore = decay(aRow);
    const bBefore = decay(bRow);

    const aAfter = applyRepeatFactor(aBefore, updateRating(aBefore, bBefore, aWon ? 1 : 0), factor);
    const bAfter = applyRepeatFactor(bBefore, updateRating(bBefore, aBefore, aWon ? 0 : 1), factor);

    const playedAt = now.toISOString();
    const event = (
      playerId: string,
      opponentIdInner: string,
      won: boolean,
      before: Rating,
      after: Rating,
      matchesPlayed: number,
    ) => ({
      player_id: playerId,
      opponent_id: opponentIdInner,
      result: won ? 'win' : 'loss',
      rating_before: before.rating,
      rd_before: before.rd,
      volatility_before: before.volatility,
      rating_after: after.rating,
      rd_after: after.rd,
      volatility_after: after.volatility,
      delta: after.rating - before.rating,
      repeat_factor: factor,
      provisional: isProvisional(matchesPlayed),
    });

    const payload = {
      match: {
        context: 'casual',
        player_a: me.id,
        player_b: opponent.id,
        winner_id: winnerId,
        best_of: bestOf,
        played_at: playedAt,
        created_by: me.id,
      },
      games: outcome.games.map((g) => ({
        game_no: g.game_no,
        score_a: g.score_a,
        score_b: g.score_b,
      })),
      events: [
        event(me.id, opponent.id, aWon, aBefore, aAfter, aRow.matches_played),
        event(opponent.id, me.id, !aWon, bBefore, bAfter, bRow.matches_played),
      ],
      ratings: [
        { player_id: me.id, ...toCols(aAfter), played_at: playedAt },
        { player_id: opponent.id, ...toCols(bAfter), played_at: playedAt },
      ],
    };

    const { data: matchId, error: applyErr } = await admin.rpc('apply_rated_match', { payload });
    if (applyErr) return jsonResponse({ error: applyErr.message }, 500);

    return jsonResponse({
      matchId,
      repeatFactor: factor,
      you: { before: round(aBefore), after: round(aAfter) },
      opponent: { before: round(bBefore), after: round(bAfter) },
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});

function toCols(r: Rating) {
  return { rating: r.rating, rd: r.rd, volatility: r.volatility };
}

function round(r: Rating) {
  return { rating: Math.round(r.rating), rd: Math.round(r.rd) };
}
