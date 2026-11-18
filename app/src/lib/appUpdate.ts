import { Platform } from 'react-native';

// Keeps the installed app on the latest version (web). Phones keep it alive in
// the background for days, so after a deploy it can go on running the old
// version: new features don't reach the player until they close it and open
// it again (the third-place match, say: an old app still shows its players as
// out, with no match to record). The service worker caches nothing (public/
// sw.js), so a reload is all it takes. Whenever the app comes back to the
// screen after a while away, this compares the script the page loaded with
// the one the deployed page loads now (its name changes with every build)
// and, if they differ, reloads into the new one.

const SCRIPT = /\/_expo\/static\/js\/web\/[^"'\s?#]+\.js/;
// Back after at least this long: a natural moment to reload, not mid-tap.
const AWAY_MS = 30_000;
// The build last reloaded into, so a page that somehow keeps the old script
// can't reload over and over.
const RELOADED_KEY = 'pingpong.update.reloadedFor';

// The app's own script, as this page loaded it (none in development).
function runningScript(): string | null {
  for (const script of Array.from(document.scripts)) {
    if (!script.src) continue;
    const match = new URL(script.src, location.href).pathname.match(SCRIPT);
    if (match) return match[0];
  }
  return null;
}

// The script the deployed page loads now.
async function deployedScript(): Promise<string | null> {
  const res = await fetch(`/?build-check=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return (await res.text()).match(SCRIPT)?.[0] ?? null;
}

function readReloaded(): string | null {
  try {
    return sessionStorage.getItem(RELOADED_KEY);
  } catch {
    return null;
  }
}

function writeReloaded(script: string): void {
  try {
    sessionStorage.setItem(RELOADED_KEY, script);
  } catch {
    // Without storage it may check again next time; never more than once a visit.
  }
}

let started = false;

export function startUpdateChecks(): void {
  if (started || Platform.OS !== 'web' || typeof document === 'undefined') return;
  started = true;
  const running = runningScript();
  if (!running) return; // a development build: nothing to compare
  let hiddenAt: number | null = null;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    if (away < AWAY_MS) return;
    deployedScript()
      .then((deployed) => {
        if (!deployed || deployed === running || readReloaded() === deployed) return;
        writeReloaded(deployed);
        location.reload();
      })
      .catch(() => {
        // Offline or the site's down: try again next time.
      });
  });
}
