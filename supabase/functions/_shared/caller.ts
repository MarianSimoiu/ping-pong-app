// Who is calling: checks the request's user token and finds that user's
// player, for the Edge Functions that act on the caller's behalf. Also hands
// back a service-role client for the writes (the RPCs are service-role only).

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { jsonResponse } from './cors.ts';

export type Caller = { admin: SupabaseClient; playerId: string; isAdmin: boolean };

// The caller, or the error response to send back (401/404/500).
export async function caller(req: Request): Promise<Caller | Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData.user) return jsonResponse({ error: 'Not authenticated' }, 401);

  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: player, error: pErr } = await admin
    .from('players')
    .select('id')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (pErr) return jsonResponse({ error: pErr.message }, 500);
  if (!player) return jsonResponse({ error: 'Player profile not found' }, 404);

  const { data: adminRow, error: aErr } = await admin
    .from('admins')
    .select('player_id')
    .eq('player_id', player.id)
    .maybeSingle();
  if (aErr) return jsonResponse({ error: aErr.message }, 500);
  return { admin, playerId: player.id, isAdmin: !!adminRow };
}
