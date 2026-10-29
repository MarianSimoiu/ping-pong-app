import { Platform } from 'react-native';

import { DEMO } from '@/lib/env';
import { isIosDevice, runningAsInstalledApp } from '@/lib/install';
import { functionErrorMessage, supabase } from '@/lib/supabase';

// Push notifications on this device (web only), switched on and off from
// Profile. Turning them on asks the browser for permission, subscribes
// through the service worker (public/sw.js) with the server's key, and stores
// the subscription with the push-subscription Edge Function. The match
// functions then notify the player about matches to confirm, and when theirs
// are confirmed or declined.
//
// iPhone and iPad only allow it in the installed app (Home Screen, iOS 16.4+).
// Once someone blocks the permission prompt, only the browser's or phone's
// settings can undo it.

export type PushStatus =
  | 'on'
  | 'off'
  | 'blocked' // the permission was refused
  | 'needs-install' // iPhone/iPad in the browser: install the app first
  | 'unsupported';

// Which player turned notifications on here, so another player signing in on
// the same browser doesn't inherit them.
const OWNER_KEY = 'pingpong.push.owner';

// DEMO mode has no server and no real subscription: the switch just remembers.
let demoOn = false;

function unsupportedReason(): PushStatus | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return 'unsupported';
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return null;
  return isIosDevice() && !runningAsInstalledApp() ? 'needs-install' : 'unsupported';
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

function base64UrlToBytes(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function sameKey(key: ArrayBuffer | null, publicKey: string): boolean {
  if (!key) return false;
  const a = new Uint8Array(key);
  const b = base64UrlToBytes(publicKey);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

function setOwner(userId: string | null) {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId);
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    // Storage unavailable (private mode): ownership just isn't tracked.
  }
}

function owner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

async function callServer<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('push-subscription', { body });
  if (error) throw new Error(await functionErrorMessage(error));
  if (!data) throw new Error('No response from push-subscription');
  return data;
}

export async function getPushStatus(): Promise<PushStatus> {
  const unsupported = unsupportedReason();
  if (unsupported) return unsupported;
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  if (DEMO) return demoOn ? 'on' : 'off';
  return (await currentSubscription()) ? 'on' : 'off';
}

export async function turnOnPush(userId: string): Promise<PushStatus> {
  const unsupported = unsupportedReason();
  if (unsupported) return unsupported;
  // Ask before anything else, while the tap still counts: Safari only shows
  // the prompt in direct response to one.
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'off';
  if (DEMO) {
    demoOn = true;
    return 'on';
  }

  await navigator.serviceWorker.register('/sw.js');
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await callServer<{ publicKey: string }>({ action: 'key' });
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options.applicationServerKey, publicKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(publicKey),
  });
  await callServer({ action: 'save', subscription: subscription.toJSON() });
  setOwner(userId);
  return 'on';
}

export async function turnOffPush(): Promise<PushStatus> {
  if (DEMO) {
    demoOn = false;
    return getPushStatus();
  }
  if (unsupportedReason()) return getPushStatus();
  const subscription = await currentSubscription();
  if (subscription) {
    // Tell the server so it stops sending, but don't let a network problem
    // keep this device subscribed: the server forgets a subscription anyway
    // the first time the push service says it's gone.
    const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
    await Promise.race([callServer({ action: 'delete', endpoint: subscription.endpoint }), timeout]).catch(() => {});
    await subscription.unsubscribe();
  }
  setOwner(null);
  return getPushStatus();
}

// Run when a player is signed in. If notifications are on here for them, it
// re-sends the subscription so the server has it even if it was lost or the
// browser renewed it; if they were on for someone else, it turns them off.
export async function syncPush(userId: string): Promise<void> {
  if (DEMO || unsupportedReason() || Notification.permission !== 'granted') return;
  try {
    const subscription = await currentSubscription();
    if (!subscription) return;
    const turnedOnBy = owner();
    if (turnedOnBy && turnedOnBy !== userId) {
      await subscription.unsubscribe();
      setOwner(null);
      return;
    }
    await callServer({ action: 'save', subscription: subscription.toJSON() });
    setOwner(userId);
  } catch {
    // Not critical: the next start tries again.
  }
}
