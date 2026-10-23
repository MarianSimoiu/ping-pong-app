import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

// Helps people add the web app to their home screen ("install" it).
//
// - Chrome, Edge, Samsung Internet (Android, and desktop): when the app can be
//   installed and isn't yet, the browser fires `beforeinstallprompt`. We keep
//   that event and replay it from our own Install button, which opens the
//   browser's real install dialog. No event = already installed, or this
//   browser can't install it. (public/sw.js is there because some Chrome
//   versions only fire the event for sites with a service worker;
//   public/index.html catches an event that fires before this code loads.)
// - iPhone/iPad: Apple lets no website install itself or tell whether it's on
//   the home screen, so we show the Share → Add to Home Screen steps whenever
//   the app is open in the browser rather than from the home screen.
// - Firefox on Android: no event either, so we show its menu steps.
// - Already running as the installed app: nothing to offer.

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

declare global {
  interface Window {
    __installPrompt?: BeforeInstallPromptEvent;
  }
}

export type InstallMethod = 'prompt' | 'ios' | 'firefox';

export type InstallState = {
  // How this browser can install the app; null when there's nothing to offer.
  method: InstallMethod | null;
  open: boolean;
  justInstalled: boolean;
};

// "Not now" hides the automatic popup for this long. The Install button on
// the Profile tab still works in the meantime.
const SNOOZE_DAYS = 7;
const SNOOZE_KEY = 'pingpong.installPrompt.snoozedUntil';
// Let the app finish loading before the popup slides in.
const AUTO_OPEN_DELAY_MS = 3000;

let state: InstallState = { method: null, open: false, justInstalled: false };
const listeners = new Set<() => void>();
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let autoOpenScheduled = false;
let isPhoneOrTablet = false;

function update(patch: Partial<InstallState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInstall(): InstallState {
  return useSyncExternalStore(subscribe, () => state);
}

function isSnoozed(): boolean {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

// Pops the sheet up on its own once per visit — phones and tablets only, and
// not while snoozed.
function scheduleAutoOpen() {
  if (autoOpenScheduled || !isPhoneOrTablet || isSnoozed()) return;
  autoOpenScheduled = true;
  setTimeout(() => {
    if (state.method && !isSnoozed()) update({ open: true });
  }, AUTO_OPEN_DELAY_MS);
}

function capturePrompt(event: BeforeInstallPromptEvent) {
  deferredPrompt = event;
  update({ method: 'prompt' });
  scheduleAutoOpen();
}

export function openInstall() {
  update({ open: true, justInstalled: false });
}

export function closeInstall() {
  update({ open: false, justInstalled: false });
}

export function snoozeInstall() {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000));
  } catch {
    // Storage unavailable (private mode): the popup may just come back next visit.
  }
  closeInstall();
}

// Opens the browser's own install dialog ('prompt' method only).
export async function promptInstall() {
  const event = deferredPrompt;
  if (!event) return;
  deferredPrompt = null; // each event can show its dialog only once
  let outcome: 'accepted' | 'dismissed' = 'dismissed';
  try {
    await event.prompt();
    ({ outcome } = await event.userChoice);
  } catch {
    // The browser refused to show it; treat it like a dismissal.
  }
  if (outcome === 'accepted') {
    update({ method: null, justInstalled: true });
  } else {
    // The browser may offer a fresh event later; until then there's no button.
    update({ method: deferredPrompt ? 'prompt' : null });
    snoozeInstall();
  }
}

function runningAsInstalledApp(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  if (!runningAsInstalledApp()) {
    const ua = navigator.userAgent;
    // iPadOS Safari reports itself as a Mac; touch support gives it away.
    const isIos =
      /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    isPhoneOrTablet = isIos || isAndroid;

    if (isIos) update({ method: 'ios' });
    else if (isAndroid && /Firefox\//.test(ua)) update({ method: 'firefox' });
    if (state.method) scheduleAutoOpen();

    if (window.__installPrompt) capturePrompt(window.__installPrompt);
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault(); // we show our own popup instead of Chrome's banner
      capturePrompt(event as BeforeInstallPromptEvent);
    });
    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      update({ method: null });
    });
  }
}
