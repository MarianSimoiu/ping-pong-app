import { clubDay } from '@/lib/schedule';

// "What's new": a short note about the latest update, shown once to each
// player on each device the next time they open the app
// (components/WhatsNewSheet.tsx). To announce an update, put a new entry
// first in UPDATES with a new id: everyone who hasn't seen that id gets it
// once, until its `until` day, after which it's no longer news.

export type Update = {
  id: string; // new for each announcement: remembered once seen
  until: string; // the last club day it's shown ("2026-12-31")
  emoji: string;
  title: string;
  subtitle: string;
  points: { icon: string; text: string }[];
  // A button that closes it and takes the player to the feature.
  action?: { label: string; to: 'challenges' };
};

export const UPDATES: Update[] = [
  {
    id: '2026-11-weekly-challenges',
    until: '2026-12-31',
    emoji: '⚡',
    title: 'New: weekly challenges',
    subtitle: 'Play people you rarely meet, and win bonus rating for it.',
    points: [
      {
        icon: '🎯',
        text: 'Every Monday you get 3 opponents: active players you’ve played least. Best of 3 or best of 5, you two decide.',
      },
      { icon: '📈', text: 'Win them for bonus rating: +25%, then +50%, then double. A loss counts as usual.' },
      {
        icon: '🏠',
        text: 'Find them on Home, in the ⚡ Weekly challenges card. After you play, tap Record next to your opponent.',
      },
      {
        icon: '🔘',
        text: 'Switch them on or off on that card, or in Profile → Settings. Join by Wednesday to start the same week.',
      },
    ],
    action: { label: 'Show me', to: 'challenges' },
  },
];

const seenKey = (userId: string) => `pingpong.whatsNew.seen.${userId}`;

function readSeen(userId: string): string | null {
  try {
    return globalThis.localStorage?.getItem(seenKey(userId)) ?? null;
  } catch {
    return null;
  }
}

export function markUpdateSeen(userId: string, id: string): void {
  try {
    globalThis.localStorage?.setItem(seenKey(userId), id);
  } catch {
    // Private mode: it shows again next time, no harm.
  }
}

// The update to show this player now: the latest, while it's news, unless
// they've seen it on this device.
export function dueUpdate(userId: string, now: number = Date.now()): Update | null {
  const latest = UPDATES[0];
  if (!latest || clubDay(now) > latest.until || readSeen(userId) === latest.id) return null;
  return latest;
}

// "Show me": Home scrolls to the challenges card when it next shows (now, if
// it's on screen; else once it's opened).
let challengesRequested = false;
const challengesListeners = new Set<() => void>();
export function requestChallengesCard(): void {
  challengesRequested = true;
  challengesListeners.forEach((l) => l());
}
export function takeChallengesCardRequest(): boolean {
  const asked = challengesRequested;
  challengesRequested = false;
  return asked;
}
export function onChallengesCardRequest(listener: () => void): () => void {
  challengesListeners.add(listener);
  return () => {
    challengesListeners.delete(listener);
  };
}

// Shown in this visit: the install, notification, tier and title popups then
// wait for the next one.
let shownThisVisit = false;
export const whatsNewThisVisit = (): boolean => shownThisVisit;
export function markWhatsNewShown(): void {
  shownThisVisit = true;
}
