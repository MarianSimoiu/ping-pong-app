// Edge Function: submit-match
//
// Records a CASUAL 1v1 match as PENDING. No rating change happens here — the
// opponent must confirm the match (see confirm-match), and ratings are computed
// at confirmation time. The caller submits their opponent and per-game scores
// (from their perspective: score_a = you, score_b = opponent). The opponent
// gets a push notification asking them to confirm it.
//
// A challenge match (migration 0031) also sends `challenge: { bestOf }`, 3 or
// 5 as the two agreed: the score has to fit that format, there has to be an
// open challenge between them this week, and no other challenge match of
// theirs waiting to be confirmed.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { resolveChallengeMatch, resolveFreeformMatch, type RawGame } from '../_shared/match.ts';
import { singlesToConfirm } from '../_shared/messages.ts';
import { afterResponse, notifyPlayers } from '../_shared/notify.ts';

type Body = { opponentId?: string; games?: RawGame[]; challenge?: { bestOf?: number } | null };

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
    const { opponentId, games = [] } = body;
    if (!opponentId) return jsonResponse({ error: 'opponentId is required' }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: me, error: meErr } = await admin
      .from('players')
      .select('id, display_name')
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

    const challenge = body.challenge ? { bestOf: Number(body.challenge.bestOf) } : null;
    let outcome;
    try {
      outcome = challenge ? resolveChallengeMatch(challenge.bestOf, games) : resolveFreeformMatch(games);
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : 'Invalid match' }, 400);
    }
    const winnerId = outcome.winner === 'a' ? me.id : opponent.id;

    const payload = {
      match: {
        player_a: me.id,
        player_b: opponent.id,
        winner_id: winnerId,
        best_of: challenge ? challenge.bestOf : outcome.games.length,
        played_at: new Date().toISOString(),
        created_by: me.id,
        challenge: !!challenge,
      },
      games: outcome.games.map((g) => ({ game_no: g.game_no, score_a: g.score_a, score_b: g.score_b })),
    };

    const { data: matchId, error: applyErr } = await admin.rpc('create_pending_match', { payload });
    // The challenge checks raise (P0001) with a message for the player.
    if (applyErr) return jsonResponse({ error: applyErr.message }, applyErr.code === 'P0001' ? 400 : 500);

    await afterResponse(
      notifyPlayers(admin, [opponent.id], singlesToConfirm({
        matchId,
        submitter: me.display_name,
        youWon: outcome.winner === 'b',
        yourGames: outcome.bWins,
        theirGames: outcome.aWins,
        challenge,
      })),
    );

    return jsonResponse({ matchId, status: 'pending' });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
