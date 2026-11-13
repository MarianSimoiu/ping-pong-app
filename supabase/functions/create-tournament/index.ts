// Edge Function: create-tournament
//
// An admin (the admins table, migration 0009) opens a tournament for
// registration until a kickoff time. Players then register themselves
// (tournament-registration), and at kickoff the draw is made
// (tournament-kickoff). The database refuses a tournament from anyone who
// isn't an admin as well (0012), whoever creates it.
//
// Every player can register (0020), and every other player gets a
// notification.

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { caller } from '../_shared/caller.ts';
import { tournamentOpened } from '../_shared/messages.ts';
import { afterResponse, notifyPlayers } from '../_shared/notify.ts';
import { checkNewTournament, errorMessage, isRuleError } from '../_shared/tournaments.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const who = await caller(req);
    if (who instanceof Response) return who;
    if (!who.isAdmin) return jsonResponse({ error: 'Only admins can create tournaments' }, 403);
    const { admin, playerId } = who;

    const checked = checkNewTournament(await req.json(), new Date());
    if (!checked.ok) return jsonResponse({ error: checked.error }, 400);
    const t = checked.value;

    const { data: tournamentId, error } = await admin.rpc('open_tournament', {
      payload: { name: t.name, best_of: t.bestOf, tier: t.tier, kickoff_at: t.kickoffAt, created_by: playerId },
    });
    if (error) return jsonResponse({ error: error.message }, isRuleError(error) ? 400 : 500);

    await afterResponse(
      (async () => {
        const { data: everyone } = await admin.from('players').select('id');
        const others = (everyone ?? []).map((p) => p.id).filter((id) => id !== playerId);
        await notifyPlayers(admin, others, tournamentOpened({ tournamentId, tournament: t.name }));
      })(),
    );

    return jsonResponse({ tournamentId });
  } catch (e) {
    return jsonResponse({ error: errorMessage(e) }, 500);
  }
});
