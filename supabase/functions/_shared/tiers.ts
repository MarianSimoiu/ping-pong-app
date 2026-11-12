// Tier names and order (migration 0014 keeps each player's tier). The app has
// the same list in app/src/lib/tiers.ts.

export const TIERS = ['unranked', 'bronze', 'silver', 'gold', 'platinum', 'diamond'] as const;
export type Tier = (typeof TIERS)[number];

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

export const tierRank = (t: string): number => TIERS.indexOf(t as Tier);

// The next tier up and the rating it starts at, if there is one.
export function nextTier(
  tier: Tier,
  lines: { tier: string; min_rating: number }[],
): { tier: Tier; rating: number } | null {
  const next = TIERS[tierRank(tier) + 1];
  if (!next || tier === 'unranked') return null;
  const line = lines.find((l) => l.tier === next);
  return line ? { tier: next, rating: Math.round(line.min_rating) } : null;
}
