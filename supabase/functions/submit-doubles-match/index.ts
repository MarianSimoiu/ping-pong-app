// Edge Function: submit-doubles-match
//
// Records a 2v2 doubles match as PENDING. The caller and their partner are one
// team, the two opponents the other; each pair becomes a team automatically
// (create_pending_doubles_match). No rating change happens here — one of the
// opponents must confirm it (see confirm-doubles-match), and both get a push
// notification asking them to. Game scores are from the caller's team's side:
// score_a = your team, score_b = the opponents.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { resolveFreeformMatch, type RawGame } from '../_shared/match.ts';
import { doublesToConfirm } from '../_shared/messages.ts';
import { afterResponse, notifyPlayers } from '../_shared/notify.ts';

type Body = { partnerId?: string; opponentIds?: string[]; games?: RawGame[] };

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
    const { partnerId, opponentIds = [], games = [] } = body;
    if (!partnerId) return jsonResponse({ error: 'partnerId is required' }, 400);
    if (opponentIds.length !== 2) return jsonResponse({ error: 'Pick two opponents' }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: me, error: meErr } = await admin
      .from('players')
      .select('id, display_name')
      .eq('user_id', userData.user.id)
      .single();
    if (meErr || !me) return jsonResponse({ error: 'Player profile not found' }, 404);

    const others = [partnerId, ...opponentIds];
    if (new Set([me.id, ...others]).size !== 4) {
      return jsonResponse({ error: 'A doubles match needs four different players' }, 400);
    }
    const { data: found, error: pErr } = await admin.from('players').select('id, display_name').in('id', others);
    if (pErr || !found || found.length !== 3) {
      return jsonResponse({ error: 'One or more players were not found' }, 404);
    }

    let outcome;
    try {
      outcome = resolveFreeformMatch(games);
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : 'Invalid match' }, 400);
    }

    const payload = {
      match: {
        created_by: me.id,
        partner: partnerId,
        opponent_1: opponentIds[0],
        opponent_2: opponentIds[1],
        winner: outcome.winner,
        games_played: outcome.games.length,
        played_at: new Date().toISOString(),
      },
      games: outcome.games.map((g) => ({ game_no: g.game_no, score_a: g.score_a, score_b: g.score_b })),
    };

    const { data: matchId, error: applyErr } = await admin.rpc('create_pending_doubles_match', { payload });
    if (applyErr) return jsonResponse({ error: applyErr.message }, 500);

    const nameOf = (id: string) => found.find((p) => p.id === id)?.display_name ?? 'Someone';
    const [o1, o2] = opponentIds;
    await afterResponse(
      Promise.all(
        [[o1, o2], [o2, o1]].map(([recipient, theirPartner]) =>
          notifyPlayers(admin, [recipient], doublesToConfirm({
            matchId,
            submitter: me.display_name,
            submitterPartner: nameOf(partnerId),
            yourPartner: nameOf(theirPartner),
            youWon: outcome.winner === 'b',
            yourGames: outcome.bWins,
            theirGames: outcome.aWins,
          }))
        ),
      ),
    );

    return jsonResponse({ matchId, status: 'pending' });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
