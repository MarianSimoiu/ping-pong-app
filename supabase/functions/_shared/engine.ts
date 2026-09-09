// Shared rating orchestration used by both submit-match (casual) and
// submit-tournament-match. Keeps a single source of truth for how a recorded
// result becomes rating_events + updated ratings. Pure given its inputs.

import {
  applyInactivity,
  applyRepeatFactor,
  isProvisional,
  updateRating,
  type Rating,
} from './glicko2.ts';

// One Glicko-2 "rating period" for inactivity purposes (see docs/RATING.md §2.4).
export const RATING_PERIOD_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RatingRow = {
  player_id: string;
  rating: number;
  rd: number;
  volatility: number;
  matches_played: number;
  last_played_at: string | null;
};

// Grow RD for time elapsed since the player last competed.
export function decay(row: RatingRow, now: Date): Rating {
  const base: Rating = { rating: row.rating, rd: row.rd, volatility: row.volatility };
  if (!row.last_played_at) return base;
  const elapsed = now.getTime() - new Date(row.last_played_at).getTime();
  const periods = Math.max(0, elapsed / (RATING_PERIOD_DAYS * DAY_MS));
  return applyInactivity(base, periods);
}

export type RatingUpdate = {
  aBefore: Rating;
  bBefore: Rating;
  aAfter: Rating;
  bAfter: Rating;
  events: Record<string, unknown>[];
  ratings: Record<string, unknown>[];
  playedAt: string;
};

// Compute the rating change for A vs B. `factor` is the repeat-opponent damping
// (1 = no damping; tournament matches always pass 1).
export function computeRatingUpdate(opts: {
  aRow: RatingRow;
  bRow: RatingRow;
  aWon: boolean;
  factor: number;
  now: Date;
}): RatingUpdate {
  const { aRow, bRow, aWon, factor, now } = opts;

  const aBefore = decay(aRow, now);
  const bBefore = decay(bRow, now);
  const aAfter = applyRepeatFactor(aBefore, updateRating(aBefore, bBefore, aWon ? 1 : 0), factor);
  const bAfter = applyRepeatFactor(bBefore, updateRating(bBefore, aBefore, aWon ? 0 : 1), factor);
  const playedAt = now.toISOString();

  const event = (
    playerId: string,
    opponentId: string,
    won: boolean,
    before: Rating,
    after: Rating,
    matchesPlayed: number,
  ) => ({
    player_id: playerId,
    opponent_id: opponentId,
    result: won ? 'win' : 'loss',
    rating_before: before.rating,
    rd_before: before.rd,
    volatility_before: before.volatility,
    rating_after: after.rating,
    rd_after: after.rd,
    volatility_after: after.volatility,
    delta: after.rating - before.rating,
    repeat_factor: factor,
    provisional: isProvisional(matchesPlayed),
  });

  return {
    aBefore,
    bBefore,
    aAfter,
    bAfter,
    events: [
      event(aRow.player_id, bRow.player_id, aWon, aBefore, aAfter, aRow.matches_played),
      event(bRow.player_id, aRow.player_id, !aWon, bBefore, bAfter, bRow.matches_played),
    ],
    ratings: [
      { player_id: aRow.player_id, rating: aAfter.rating, rd: aAfter.rd, volatility: aAfter.volatility, played_at: playedAt },
      { player_id: bRow.player_id, rating: bAfter.rating, rd: bAfter.rd, volatility: bAfter.volatility, played_at: playedAt },
    ],
    playedAt,
  };
}

export const roundRating = (r: Rating) => ({ rating: Math.round(r.rating), rd: Math.round(r.rd) });
