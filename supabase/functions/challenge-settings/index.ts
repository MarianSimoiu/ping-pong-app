// Edge Function: challenge-settings
//
// Switches weekly challenges (migration 0031) on or off for the signed-in
// player, from Home or Settings:
//   { on: true, thisWeek: true }  -> from this week if it's still Monday to
//                                    Wednesday (club time), with this week's 3
//                                    challenges made straight away; else from
//                                    next Monday
//   { on: true }                  -> from next Monday
//   { on: false }                 -> no more weeks (this week's still count)
// Returns { startsOn }: the Monday of their first week, or null when off.

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { caller } from '../_shared/caller.ts';
import { errorMessage } from '../_shared/tournaments.ts';

type Body = { on?: unknown; thisWeek?: unknown };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const who = await caller(req);
    if (who instanceof Response) return who;

    const body = (await req.json()) as Body;
    if (typeof body.on !== 'boolean') return jsonResponse({ error: 'on must be true or false' }, 400);

    const { data: startsOn, error } = await who.admin.rpc('set_challenges', {
      p_player: who.playerId,
      p_on: body.on,
      p_this_week: body.thisWeek === true,
    });
    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ startsOn: startsOn ?? null });
  } catch (e) {
    return jsonResponse({ error: errorMessage(e) }, 500);
  }
});
