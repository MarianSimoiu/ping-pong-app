// Edge Function: create-tournament
//
// Creates a single-elimination tournament. The caller passes an ordered list of
// participant player ids (index 0 = top seed). This function generates the full
// bracket (tested TS) and persists tournament + participants + bracket nodes
// atomically via the create_tournament RPC. Byes are handled by the generator.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { generateSingleElim, nextPowerOfTwo } from '../_shared/bracket.ts';

type Body = {
  name?: string;
  tier?: number;
  bestOf?: number;
  participantIds?: string[]; // ordered by seed, best first
};

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
    const name = (body.name ?? '').trim();
    const participantIds = body.participantIds ?? [];
    const tier = body.tier ?? 1;
    const bestOf = body.bestOf ?? 3;

    if (!name) return jsonResponse({ error: 'A tournament name is required' }, 400);
    if (new Set(participantIds).size !== participantIds.length) {
      return jsonResponse({ error: 'Participants must be unique' }, 400);
    }
    if (participantIds.length < 2) return jsonResponse({ error: 'Add at least 2 participants' }, 400);
    if (participantIds.length > 32) return jsonResponse({ error: 'At most 32 participants' }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: creator, error: cErr } = await admin
      .from('players')
      .select('id')
      .eq('user_id', userData.user.id)
      .single();
    if (cErr || !creator) return jsonResponse({ error: 'Player profile not found' }, 404);

    // Verify every participant exists.
    const { data: found, error: pErr } = await admin
      .from('players')
      .select('id')
      .in('id', participantIds);
    if (pErr || !found || found.length !== participantIds.length) {
      return jsonResponse({ error: 'One or more participants were not found' }, 400);
    }

    // Generate the bracket (byes auto-advance top seeds).
    let nodes;
    try {
      nodes = generateSingleElim(participantIds);
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : 'Invalid bracket' }, 400);
    }
    const size = nextPowerOfTwo(participantIds.length);

    const payload = {
      tournament: {
        name,
        format: 'single_elim',
        tier,
        best_of: bestOf,
        size,
        created_by: creator.id,
      },
      participants: participantIds.map((player_id, i) => ({ player_id, seed: i + 1 })),
      nodes: nodes.map((n) => ({
        round: n.round,
        slot: n.slot,
        player_a: n.playerA,
        player_b: n.playerB,
        winner_id: n.winner,
        status: n.status,
      })),
    };

    const { data: tournamentId, error: applyErr } = await admin.rpc('create_tournament', { payload });
    if (applyErr) return jsonResponse({ error: applyErr.message }, 500);

    return jsonResponse({ tournamentId, size });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
