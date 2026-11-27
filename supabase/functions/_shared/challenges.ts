// Weekly challenges (migration 0031, docs/RATING.md §6): the boost on a
// challenge win. Pure, so the app's copy (app/src/lib/challengeRules.ts) and the
// tests can check the same numbers.

// The boost on the rating a challenge win gains, by how many challenges the
// winner had already won that week: the 1st win +25%, the 2nd +50%, the 3rd
// double. A loss counts as usual.
export const CHALLENGE_BOOSTS = [1.25, 1.5, 2] as const;

export function challengeBoost(winsBefore: number): number {
  return CHALLENGE_BOOSTS[Math.max(0, Math.min(winsBefore, CHALLENGE_BOOSTS.length - 1))];
}

// "+25%", "+50%", "×2".
export function boostLabel(boost: number): string {
  return boost >= 2 ? `×${Math.round(boost * 10) / 10}` : `+${Math.round((boost - 1) * 100)}%`;
}

// A challenge match is one of these, as the two players agree.
export const CHALLENGE_FORMATS = [3, 5] as const;
