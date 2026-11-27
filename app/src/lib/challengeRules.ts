import { addDays, clubDay } from '@/lib/schedule';

// The rules of weekly challenges (migration 0031, docs/RATING.md §6), with no
// data access, so the demo backend can use them too (lib/challenges.ts is the
// rest). Winning your challenge boosts the rating you gain: your 1st
// challenge win of the week by 25%, the 2nd by 50%, the 3rd doubles it. A
// loss counts as usual.

// Keep in step with supabase/functions/_shared/challenges.ts.
export const CHALLENGE_BOOSTS = [1.25, 1.5, 2] as const;
export const CHALLENGE_FORMATS = [3, 5] as const;

export const challengeBoost = (winsBefore: number): number =>
  CHALLENGE_BOOSTS[Math.max(0, Math.min(winsBefore, CHALLENGE_BOOSTS.length - 1))];

// "+25%", "+50%", "×2".
export const boostLabel = (boost: number): string =>
  boost >= 2 ? `×${Math.round(boost * 10) / 10}` : `+${Math.round((boost - 1) * 100)}%`;

// The Monday of a club day's week ("2026-11-26" → "2026-11-23").
export function weekStart(day: string): string {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 Sunday … 6 Saturday
  return addDays(day, -((weekday + 6) % 7));
}

export const thisWeek = (now: number = Date.now()): string => weekStart(clubDay(now));

// Until Wednesday there's still time to play three matches this week.
export function canStartThisWeek(now: number = Date.now()): boolean {
  const weekday = new Date(`${clubDay(now)}T12:00:00Z`).getUTCDay();
  return weekday >= 1 && weekday <= 3;
}

export type ChallengeOpponent = {
  opponentId: string;
  name: string;
  avatarUrl: string | null;
  rating: number | null;
  result: 'won' | 'lost' | null; // null: still to play
  multiplier: number | null; // the boost the win earned
  delta: number | null; // your rating change from it
  score: { mine: number; theirs: number } | null;
  mutual: boolean; // their challenge too
};

export type ChallengeState = {
  week: string; // this week's Monday
  startsOn: string | null; // switched on, from this Monday; null: off
  mine: ChallengeOpponent[]; // your challenges this week
  // Players whose challenge you are this week (and not yours), still to play.
  pickedBy: { playerId: string; name: string; avatarUrl: string | null }[];
};

export const isOn = (s: ChallengeState): boolean => s.startsOn !== null;
export const challengeWins = (s: ChallengeState): number => s.mine.filter((c) => c.result === 'won').length;

// The boost your next challenge win would get, while you have one to play.
export function nextBoost(s: ChallengeState): number | null {
  return s.mine.some((c) => c.result === null) ? challengeBoost(challengeWins(s)) : null;
}

// The challenge still to play between you and a player this week, if any:
// yours (and what your win would earn), theirs, or both.
export function challengeWith(
  s: ChallengeState,
  playerId: string,
): { yours: boolean; theirs: boolean; boost: number | null } | null {
  const mine = s.mine.find((c) => c.opponentId === playerId && c.result === null);
  const theirs = !!mine?.mutual || s.pickedBy.some((p) => p.playerId === playerId);
  if (!mine && !theirs) return null;
  return { yours: !!mine, theirs, boost: mine ? challengeBoost(challengeWins(s)) : null };
}
