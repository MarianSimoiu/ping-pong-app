// Edge Function: manage-tournament
//
// An admin's controls for a tournament that hasn't started:
//   start       make the draw now instead of waiting for the kickoff time
//   reschedule  move the kickoff (kickoffAt), e.g. when too few registered
//   cancel      call it off
// Each one tells the registered players. The database checks the caller is an
// admin again (0012).

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { caller } from '../_shared/caller.ts';
import { announceDraw, startTournament } from '../_shared/kickoff.ts';
import { type PushMessage, tournamentCancelled, tournamentRescheduled } from '../_shared/messages.ts';
import { afterResponse, notifyPlayers } from '../_shared/notify.ts';
import { checkKickoff, errorMessage, isRuleError } from '../_shared/tournaments.ts';

type Body = { tournamentId?: string; action?: 'start' | 'reschedule' | 'cancel'; kickoffAt?: string };

// Sends a message about the tournament to everyone registered for it.
async function tellRegistered(
  admin: SupabaseClient,
  tournamentId: string,
  message: (t: { tournamentId: string; tournament: string }) => PushMessage,
): Promise<void> {
  try {
    const [{ data: t }, { data: registered }] = await Promise.all([
      admin.from('tournaments').select('name').eq('id', tournamentId).single(),
      admin.from('tournament_participants').select('player_id').eq('tournament_id', tournamentId),
    ]);
    if (!t) return;
    await notifyPlayers(
      admin,
      (registered ?? []).map((r) => r.player_id),
      message({ tournamentId, tournament: t.name }),
    );
  } catch (e) {
    console.warn('Notifications failed', e);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const who = await caller(req);
    if (who instanceof Response) return who;
    if (!who.isAdmin) return jsonResponse({ error: 'Only admins can manage tournaments' }, 403);
    const { admin, playerId } = who;

    const { tournamentId, action, kickoffAt } = (await req.json()) as Body;
    if (!tournamentId) return jsonResponse({ error: 'tournamentId is required' }, 400);

    if (action === 'start') {
      const outcome = await startTournament(admin, tournamentId, playerId);
      if (!outcome.started) return jsonResponse({ error: outcome.reason }, 400);
      await afterResponse(announceDraw(admin, tournamentId));
      return jsonResponse({ status: 'active' });
    }

    if (action === 'reschedule') {
      const kickoff = checkKickoff(kickoffAt, new Date());
      if (!kickoff.ok) return jsonResponse({ error: kickoff.error }, 400);
      const { error } = await admin.rpc('reschedule_tournament', {
        p_tournament: tournamentId,
        p_admin: playerId,
        p_kickoff_at: kickoff.value,
      });
      if (error) return jsonResponse({ error: error.message }, isRuleError(error) ? 400 : 500);
      await afterResponse(tellRegistered(admin, tournamentId, tournamentRescheduled));
      return jsonResponse({ kickoffAt: kickoff.value });
    }

    if (action === 'cancel') {
      const { error } = await admin.rpc('cancel_tournament', { p_tournament: tournamentId, p_admin: playerId });
      if (error) return jsonResponse({ error: error.message }, isRuleError(error) ? 400 : 500);
      await afterResponse(tellRegistered(admin, tournamentId, tournamentCancelled));
      return jsonResponse({ status: 'cancelled' });
    }

    return jsonResponse({ error: 'action must be start, reschedule or cancel' }, 400);
  } catch (e) {
    return jsonResponse({ error: errorMessage(e) }, isRuleError(e) ? 400 : 500);
  }
});
