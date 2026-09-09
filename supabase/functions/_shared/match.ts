// Pure match-validation helpers, shared by the Edge Function (and testable).

export type RawGame = { score_a: number; score_b: number };

export type ValidatedGame = RawGame & { game_no: number; winner: 'a' | 'b' };

export type MatchOutcome = {
  games: ValidatedGame[];
  winner: 'a' | 'b';
  aWins: number;
  bWins: number;
};

/** A ping-pong game is valid when a side reaches >= 11 and wins by >= 2. */
export function isValidGame(g: RawGame): boolean {
  if (!Number.isInteger(g.score_a) || !Number.isInteger(g.score_b)) return false;
  if (g.score_a < 0 || g.score_b < 0) return false;
  const hi = Math.max(g.score_a, g.score_b);
  const margin = Math.abs(g.score_a - g.score_b);
  return hi >= 11 && margin >= 2;
}

/**
 * Validate the games and resolve the match winner for a best-of series.
 * Throws an Error (with a client-safe message) on any invalid input.
 */
export function resolveMatch(bestOf: number, raw: RawGame[]): MatchOutcome {
  if (![1, 3, 5, 7].includes(bestOf)) throw new Error('best_of must be 1, 3, 5, or 7');
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('At least one game is required');
  if (raw.length > bestOf) throw new Error('More games than best_of allows');

  const needed = Math.floor(bestOf / 2) + 1;
  let aWins = 0;
  let bWins = 0;
  const games: ValidatedGame[] = raw.map((g, i) => {
    if (!isValidGame(g)) {
      throw new Error(`Game ${i + 1} is not a valid 11-point game (win by 2)`);
    }
    const winner: 'a' | 'b' = g.score_a > g.score_b ? 'a' : 'b';
    if (winner === 'a') aWins += 1;
    else bWins += 1;
    return { ...g, game_no: i + 1, winner };
  });

  if (aWins < needed && bWins < needed) {
    throw new Error(`Series is not decided: need ${needed} game wins`);
  }
  return { games, winner: aWins >= needed ? 'a' : 'b', aWins, bWins };
}
