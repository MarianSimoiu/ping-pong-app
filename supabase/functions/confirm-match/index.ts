// Edge Function: confirm-match
//
// The opponent confirms or declines a pending casual match. Only the participant
// who did NOT submit it may act. On confirm, ratings are computed NOW (using
// current values + the repeat-opponent guard) and applied atomically; on
// decline, the match is marked rejected and never affects ratings.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { repeatFactor } from '../_shared/glicko2.ts';
import { computeRatingUpdate, roundRating, type RatingRow } from '../_shared/engine.ts';

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
      .select('id')
      .eq('user_id', userData.user.id)
      .single();
    if (callerErr || !caller) return jsonResponse({ error: 'Player profile not found' }, 404);

    const { data: match, error: mErr } = await admin
      .from('matches')
      .select('id, player_a, player_b, winner_id, best_of, created_by, status')
      .eq('id', matchId)
      .single();
    if (mErr || !match) return jsonResponse({ error: 'Match not found' }, 404);
    if (match.status !== 'pending') return jsonResponse({ error: 'This match is no longer pending' }, 400);

    const isParticipant = caller.id === match.player_a || caller.id === match.player_b;
    if (!isParticipant) return jsonResponse({ error: 'You are not in this match' }, 403);
    if (caller.id === match.created_by) {
      return jsonResponse({ error: 'Your opponent must confirm the match you submitted' }, 403);
    }

    if (action === 'decline') {
      const { error: rejErr } = await admin.rpc('reject_match', { match_id: matchId });
      if (rejErr) return jsonResponse({ error: rejErr.message }, 500);
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

    // Repeat-opponent guard: confirmed H2H games between the pair in the last 24h.
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
    const factor = repeatFactor(priorToday ?? 0);

    const aWon = match.winner_id === match.player_a;
    const update = computeRatingUpdate({ aRow, bRow, aWon, factor, now: new Date() });

    const { error: confirmErr } = await admin.rpc('confirm_match', {
      payload: { match_id: matchId, events: update.events, ratings: update.ratings },
    });
    if (confirmErr) return jsonResponse({ error: confirmErr.message }, 500);

    return jsonResponse({
      status: 'confirmed',
      repeatFactor: factor,
      playerA: { before: roundRating(update.aBefore), after: roundRating(update.aAfter) },
      playerB: { before: roundRating(update.bBefore), after: roundRating(update.bAfter) },
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
