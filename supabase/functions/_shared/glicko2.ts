// Glicko-2 rating system (Glickman, 2013) + the app's anti-farming guards.
//
// This module is PURE (no I/O) so the exact same code runs inside the
// `submit-match` Edge Function and inside `glicko2.test.ts`. Every number the
// app produces can therefore be reproduced and verified from here.
//
// We treat each match as a one-game "rating period". `updatePeriod` implements
// the general multi-game formula (used by the tests to reproduce Glickman's
// canonical worked example); `updateRating` is the single-opponent convenience.

export const GLICKO2 = {
  /** Scale factor between the display scale (Elo-like) and the internal scale. */
  SCALE: 173.7178,
  DEFAULT_RATING: 1500,
  DEFAULT_RD: 350,
  DEFAULT_VOLATILITY: 0.06,
  /** System constant τ: constrains volatility change. Smaller = steadier. */
  TAU: 0.5,
  /** Below this many matches a player is "provisional" (rating still settling). */
  PROVISIONAL_MATCHES: 10,
  /** Convergence tolerance for the volatility solver. */
  CONVERGENCE: 1e-6,
} as const;

export type Rating = { rating: number; rd: number; volatility: number };
/** 1 = win, 0 = loss, 0.5 = draw (ping pong has no draws, kept for generality). */
export type Score = number;
export type Game = { opponent: Rating; score: Score };

export function defaultRating(): Rating {
  return {
    rating: GLICKO2.DEFAULT_RATING,
    rd: GLICKO2.DEFAULT_RD,
    volatility: GLICKO2.DEFAULT_VOLATILITY,
  };
}

// --- internal helpers (operate on the Glicko-2 scale) ------------------------

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expectation(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

/** Solve for the new volatility via the Illinois algorithm (Glickman step 5). */
function newVolatility(sigma: number, phi: number, v: number, delta: number): number {
  const { TAU, CONVERGENCE } = GLICKO2;
  const a = Math.log(sigma * sigma);
  const d2 = delta * delta;
  const phi2 = phi * phi;

  const f = (x: number): number => {
    const ex = Math.exp(x);
    const num = ex * (d2 - phi2 - v - ex);
    const den = 2 * Math.pow(phi2 + v + ex, 2);
    return num / den - (x - a) / (TAU * TAU);
  };

  let A = a;
  let B: number;
  if (d2 > phi2 + v) {
    B = Math.log(d2 - phi2 - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k += 1;
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > CONVERGENCE) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  return Math.exp(A / 2);
}

// --- public API --------------------------------------------------------------

/**
 * Update a player's rating over a set of games in one rating period.
 * An empty `games` array is treated as inactivity (only RD grows).
 */
export function updatePeriod(player: Rating, games: Game[]): Rating {
  const { SCALE, DEFAULT_RATING } = GLICKO2;
  const mu = (player.rating - DEFAULT_RATING) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.volatility;

  if (games.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { rating: player.rating, rd: phiStar * SCALE, volatility: sigma };
  }

  let vInv = 0;
  let deltaSum = 0;
  for (const game of games) {
    const muJ = (game.opponent.rating - DEFAULT_RATING) / SCALE;
    const phiJ = game.opponent.rd / SCALE;
    const gj = g(phiJ);
    const e = expectation(mu, muJ, phiJ);
    vInv += gj * gj * e * (1 - e);
    deltaSum += gj * (game.score - e);
  }

  const v = 1 / vInv;
  const delta = v * deltaSum;

  const sigmaPrime = newVolatility(sigma, phi, v, delta);
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * deltaSum;

  return {
    rating: muPrime * SCALE + DEFAULT_RATING,
    rd: phiPrime * SCALE,
    volatility: sigmaPrime,
  };
}

/** Single-opponent update (one match = one rating period). */
export function updateRating(player: Rating, opponent: Rating, score: Score): Rating {
  return updatePeriod(player, [{ opponent, score }]);
}

/**
 * Inactivity/RD decay: grow a player's RD for `periods` of not competing.
 * RD is capped at the default (350) — an unproven player is never more
 * uncertain than a brand-new one.
 */
export function applyInactivity(player: Rating, periods: number): Rating {
  if (periods <= 0) return player;
  const { SCALE, DEFAULT_RD } = GLICKO2;
  const phi = player.rd / SCALE;
  const phiStar = Math.sqrt(phi * phi + player.volatility * player.volatility * periods);
  return {
    rating: player.rating,
    rd: Math.min(phiStar * SCALE, DEFAULT_RD),
    volatility: player.volatility,
  };
}

// --- anti-farming guards -----------------------------------------------------

/**
 * Diminishing returns for repeatedly playing the SAME opponent within a day.
 * `priorGamesToday` = confirmed matches already played vs this opponent today,
 * BEFORE the current one. So the current game's number is priorGamesToday + 1.
 *   games 1-2 -> 1.0, game 3 -> 0.5, game 4 -> 0.25, game 5+ -> 0.
 */
export function repeatFactor(priorGamesToday: number): number {
  if (priorGamesToday <= 1) return 1; // 1st or 2nd game of the day
  if (priorGamesToday === 2) return 0.5; // 3rd
  if (priorGamesToday === 3) return 0.25; // 4th
  return 0; // 5th and beyond
}

/**
 * Scale the RATING change by the repeat factor, while still letting RD and
 * volatility update normally (you gain information from the game even if the
 * rating move is damped).
 */
export function applyRepeatFactor(before: Rating, after: Rating, factor: number): Rating {
  return {
    rating: before.rating + (after.rating - before.rating) * factor,
    rd: after.rd,
    volatility: after.volatility,
  };
}

export function isProvisional(matchesPlayed: number): boolean {
  return matchesPlayed < GLICKO2.PROVISIONAL_MATCHES;
}
