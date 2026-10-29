// Edge Function: push-subscription
//
// Turns push notifications on or off for the signed-in player's current
// device (Profile → Notifications in the app):
//   { action: 'key' }                 -> { publicKey }  the key the browser subscribes with
//   { action: 'save', subscription }  -> { ok: true }   notifications on (or refreshed)
//   { action: 'delete', endpoint }    -> { ok: true }   notifications off
// A device belongs to whoever turned notifications on there last: saving an
// endpoint another player had moves it to the caller.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { vapidKeys } from '../_shared/notify.ts';
import { base64UrlDecode } from '../_shared/webpush.ts';

type Body = {
  action?: 'key' | 'save' | 'delete';
  subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  endpoint?: unknown;
};

// The push services browsers use: Google's (Chrome, Edge on Android, Samsung,
// Opera), Mozilla's (Firefox), Apple's (Safari, iPhone) and Microsoft's (Edge
// on Windows). Anything else is refused, so the server only ever sends to them.
const PUSH_SERVICE_HOSTS = ['.googleapis.com', '.mozilla.com', '.push.apple.com', '.notify.windows.com'];

function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1000) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && PUSH_SERVICE_HOSTS.some((host) => url.hostname.endsWith(host));
  } catch {
    return false;
  }
}

// Byte length of a base64url key, or -1 if it isn't one.
function keyBytes(value: unknown): number {
  if (typeof value !== 'string' || !/^[\w-]+={0,2}$/.test(value)) return -1;
  try {
    return base64UrlDecode(value.replace(/=+$/, '')).length;
  } catch {
    return -1;
  }
}

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
    const admin = createClient(supabaseUrl, serviceKey);

    if (body.action === 'key') {
      const { publicKey } = await vapidKeys(admin);
      return jsonResponse({ publicKey });
    }

    const { data: me, error: meErr } = await admin
      .from('players')
      .select('id')
      .eq('user_id', userData.user.id)
      .single();
    if (meErr || !me) return jsonResponse({ error: 'Player profile not found' }, 404);

    if (body.action === 'save') {
      const sub = body.subscription;
      if (!isPushEndpoint(sub?.endpoint)) {
        return jsonResponse({ error: "This browser's notification service isn't supported" }, 400);
      }
      const p256dh = sub.keys?.p256dh;
      const auth = sub.keys?.auth;
      if (keyBytes(p256dh) !== 65 || keyBytes(auth) !== 16) {
        return jsonResponse({ error: 'Invalid subscription keys' }, 400);
      }
      const { error } = await admin.from('push_subscriptions').upsert(
        { player_id: me.id, endpoint: sub.endpoint, p256dh, auth, updated_at: new Date().toISOString() },
        { onConflict: 'endpoint' },
      );
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ ok: true });
    }

    if (body.action === 'delete') {
      if (typeof body.endpoint !== 'string') return jsonResponse({ error: 'endpoint is required' }, 400);
      const { error } = await admin
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', body.endpoint)
        .eq('player_id', me.id);
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
