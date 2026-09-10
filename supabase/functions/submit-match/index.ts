// Edge Function: submit-match
//
// Records a CASUAL 1v1 match as PENDING. No rating change happens here — the
// opponent must confirm the match (see confirm-match), and ratings are computed
// at confirmation time. The caller submits their opponent and per-game scores
// (from their perspective: score_a = you, score_b = opponent).

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { resolveMatch, type RawGame } from '../_shared/match.ts';

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
    const winnerId = outcome.winner === 'a' ? me.id : opponent.id;

    const payload = {
      match: {
        player_a: me.id,
        player_b: opponent.id,
        winner_id: winnerId,
        best_of: bestOf,
        played_at: new Date().toISOString(),
        created_by: me.id,
      },
      games: outcome.games.map((g) => ({ game_no: g.game_no, score_a: g.score_a, score_b: g.score_b })),
    };

    const { data: matchId, error: applyErr } = await admin.rpc('create_pending_match', { payload });
    if (applyErr) return jsonResponse({ error: applyErr.message }, 500);

    return jsonResponse({ matchId, status: 'pending' });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
