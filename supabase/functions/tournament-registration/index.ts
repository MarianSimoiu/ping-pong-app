// Edge Function: tournament-registration
//
// The signed-in player registers for a tournament, or withdraws, before its
// kickoff. The rules live in the database (register_for_tournament /
// withdraw_from_tournament, migrations 0012 and 0020): anyone can register
// (with no matches yet, they count as 1500 for the pots), and nobody can join
// or leave once kickoff time has come.

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { caller } from '../_shared/caller.ts';
import { errorMessage, isRuleError } from '../_shared/tournaments.ts';

type Body = { tournamentId?: string; action?: 'register' | 'withdraw' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const who = await caller(req);
    if (who instanceof Response) return who;

    const { tournamentId, action } = (await req.json()) as Body;
    if (!tournamentId) return jsonResponse({ error: 'tournamentId is required' }, 400);
    if (action !== 'register' && action !== 'withdraw') {
      return jsonResponse({ error: 'action must be register or withdraw' }, 400);
    }

    const { error } = await who.admin.rpc(
      action === 'register' ? 'register_for_tournament' : 'withdraw_from_tournament',
      { p_tournament: tournamentId, p_player: who.playerId },
    );
    if (error) return jsonResponse({ error: error.message }, isRuleError(error) ? 400 : 500);

    return jsonResponse({ registered: action === 'register' });
  } catch (e) {
    return jsonResponse({ error: errorMessage(e) }, 500);
  }
});
