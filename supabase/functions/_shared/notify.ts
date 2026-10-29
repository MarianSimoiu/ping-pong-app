// Sends push notifications to players' devices (the devices are in
// push_subscriptions, migration 0011; the protocol is in webpush.ts). The
// match Edge Functions call notifyPlayers after a match is recorded,
// confirmed or declined, with a message from messages.ts.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import type { PushMessage } from './messages.ts';
import { generateVapidKeys, sendPush, type VapidKeys } from './webpush.ts';

// Who runs this sender, as push services ask every sender to say.
const CONTACT = 'https://github.com/MarianSimoiu/ping-pong-app';

// The server's VAPID keys, created on first use. If two requests race to
// create them, the first row stored wins and both use it.
export async function vapidKeys(admin: SupabaseClient): Promise<VapidKeys> {
  const read = async (): Promise<VapidKeys | null> => {
    const { data, error } = await admin.from('push_keys').select('public_key, private_jwk').maybeSingle();
    if (error) throw error;
    return data ? { publicKey: data.public_key, privateJwk: data.private_jwk } : null;
  };
  const existing = await read();
  if (existing) return existing;
  const fresh = await generateVapidKeys();
  const { error } = await admin
    .from('push_keys')
    .upsert({ id: true, public_key: fresh.publicKey, private_jwk: fresh.privateJwk }, {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
  if (error) throw error;
  const stored = await read();
  if (!stored) throw new Error('Could not store the push keys');
  return stored;
}

// Sends `message` to every device where these players turned notifications
// on. Never throws: a notification that can't be sent must not fail the
// request that triggered it.
export async function notifyPlayers(admin: SupabaseClient, playerIds: string[], message: PushMessage): Promise<void> {
  try {
    if (playerIds.length === 0) return;
    const { data: devices, error } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('player_id', playerIds);
    if (error) throw error;
    if (!devices || devices.length === 0) return;

    const keys = await vapidKeys(admin);
    const payload = JSON.stringify(message);
    await Promise.all(
      devices.map(async (device) => {
        try {
          const res = await sendPush(device, payload, keys, CONTACT);
          if (res.status === 404 || res.status === 410) {
            // The browser unsubscribed, or the subscription expired: forget it.
            await res.body?.cancel();
            await admin.from('push_subscriptions').delete().eq('id', device.id);
          } else if (!res.ok) {
            console.warn(`Push to ${new URL(device.endpoint).host} failed: ${res.status} ${await res.text()}`);
          } else {
            await res.body?.cancel();
          }
        } catch (e) {
          console.warn('Push failed', e);
        }
      }),
    );
  } catch (e) {
    console.warn('Notifications failed', e);
  }
}

// Lets `work` finish after the response has been sent, where the runtime
// supports it (Supabase's EdgeRuntime.waitUntil); otherwise waits for it.
export async function afterResponse(work: Promise<unknown>): Promise<void> {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work);
  else await work;
}
