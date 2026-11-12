// Checks for what an admin sends when creating or rescheduling a tournament
// (pure, testable). The database checks the same rules again.

export const MAX_NAME_LENGTH = 60;
export const BEST_OF = [1, 3, 5, 7] as const;
// Far enough ahead that the kickoff isn't already past when it's saved; close
// enough that a typo in the year is caught.
export const MIN_LEAD_MS = 60 * 1000;
export const MAX_LEAD_MS = 365 * 24 * 60 * 60 * 1000;

export type NewTournament = { name: string; bestOf: number; tier: number; kickoffAt: string };

type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

export function checkKickoff(value: unknown, now: Date): Checked<string> {
  const at = typeof value === 'string' ? new Date(value) : null;
  if (!at || Number.isNaN(at.getTime())) return { ok: false, error: 'Pick a kickoff date and time' };
  const lead = at.getTime() - now.getTime();
  if (lead < MIN_LEAD_MS) return { ok: false, error: 'Pick a kickoff time in the future' };
  if (lead > MAX_LEAD_MS) return { ok: false, error: 'Pick a kickoff within the next year' };
  return { ok: true, value: at.toISOString() };
}

export function checkNewTournament(
  body: { name?: unknown; bestOf?: unknown; tier?: unknown; kickoffAt?: unknown },
  now: Date,
): Checked<NewTournament> {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { ok: false, error: 'Give the tournament a name' };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, error: `Keep the name under ${MAX_NAME_LENGTH} characters` };
  const bestOf = body.bestOf ?? 3;
  if (!BEST_OF.includes(bestOf as (typeof BEST_OF)[number])) return { ok: false, error: 'Best of 1, 3, 5 or 7' };
  const tier = body.tier ?? 1;
  if (tier !== 1 && tier !== 2 && tier !== 3) return { ok: false, error: 'Tier 1, 2 or 3' };
  const kickoff = checkKickoff(body.kickoffAt, now);
  if (!kickoff.ok) return kickoff;
  return { ok: true, value: { name, bestOf: bestOf as number, tier, kickoffAt: kickoff.value } };
}

// supabase-js reports database errors as plain objects ({ message, code }),
// not Error instances. A rule in an RPC (`raise exception` with no code) comes
// back as P0001, and its message is written for the player.
export function errorMessage(e: unknown, fallback = 'Unexpected error'): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return fallback;
}

export function isRuleError(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: unknown }).code === 'P0001';
}
