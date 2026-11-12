// Tiers (migration 0014): Bronze → Diamond from the skill rating, for players
// on the leaderboard; Legend is #1 on the leaderboard. The server's list is
// supabase/functions/_shared/tiers.ts: keep them in step.

export const TIERS = ['unranked', 'bronze', 'silver', 'gold', 'platinum', 'diamond'] as const;
export type Tier = (typeof TIERS)[number];

export type TierLine = { tier: Tier; minRating: number };

// What the app knows about a player's standing (the player_badges view).
export type PlayerBadge = {
  playerId: string;
  tier: Tier;
  bestTier: Tier;
  legend: boolean; // #1 on the leaderboard
  inactive: boolean; // no rated match for 30 days
};

export const TIER_NAMES: Record<Tier, string> = {
  unranked: 'Unranked',
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  diamond: 'Diamond',
};

export const TIER_EMOJI: Record<Tier, string> = {
  unranked: '',
  bronze: '🥉',
  silver: '🥈',
  gold: '🥇',
  platinum: '💠',
  diamond: '💎',
};

export const LEGEND_EMOJI = '🌟';

// Ring colors (a gradient from the first to the second), readable on both themes.
export type RingStyle = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'legend' | 'inactive';
export const RING_COLORS: Record<RingStyle, [string, string]> = {
  bronze: ['#E7A46F', '#8E4F25'],
  silver: ['#E6EBF0', '#7F8B98'],
  gold: ['#FFE07A', '#C28D10'],
  platinum: ['#9FF0E5', '#1F9A8F'],
  diamond: ['#9ED8FF', '#6E5BFF'],
  legend: ['#FF5A6E', '#FFC23A'],
  inactive: ['#C9C1C1', '#7E7676'],
};

export const tierRank = (t: Tier): number => TIERS.indexOf(t);

// The ring a player's avatar gets: none until they're on the leaderboard.
export function ringFor(badge: PlayerBadge | null | undefined): RingStyle | null {
  if (!badge || badge.tier === 'unranked') return null;
  if (badge.inactive) return 'inactive';
  if (badge.legend) return 'legend';
  return badge.tier;
}

// The label for a player's tier, e.g. "🥇 Gold", "🌟 Legend".
export function tierLabel(badge: PlayerBadge): string {
  if (badge.tier === 'unranked') return 'Unranked';
  if (badge.legend) return `${LEGEND_EMOJI} Legend`;
  return `${TIER_EMOJI[badge.tier]} ${TIER_NAMES[badge.tier]}`;
}

// Where a rating stands between its tier's line and the next one.
export function tierProgress(
  tier: Tier,
  rating: number,
  lines: TierLine[],
): { next: Tier; nextAt: number; toGo: number; fraction: number } | null {
  if (tier === 'unranked' || tier === 'diamond') return null;
  const next = TIERS[tierRank(tier) + 1];
  const nextLine = lines.find((l) => l.tier === next);
  if (!nextLine) return null;
  const ownLine = lines.find((l) => l.tier === tier)?.minRating ?? nextLine.minRating - 100;
  const span = Math.max(1, nextLine.minRating - ownLine);
  const fraction = Math.min(1, Math.max(0, (rating - ownLine) / span));
  return { next, nextAt: Math.round(nextLine.minRating), toGo: Math.max(0, Math.ceil(nextLine.minRating - rating)), fraction };
}

export const DEFAULT_TIER_LINES: TierLine[] = [
  { tier: 'silver', minRating: 1400 },
  { tier: 'gold', minRating: 1500 },
  { tier: 'platinum', minRating: 1600 },
  { tier: 'diamond', minRating: 1700 },
];
