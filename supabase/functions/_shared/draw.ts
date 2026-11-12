// The tournament draw (pure, testable), made at kickoff (kickoff.ts).
//
// Registered players come in with the pot their rating puts them in: the
// database decides pots (the tournament_live_pots view, migration 0012), so the
// draw uses exactly the pots the app showed during registration. Each pot is
// shuffled, then the pots are laid out as seeds in order: Pot 1's players get
// seeds 1, 2, ..., then Pot 2's, and so on. Fed through the standard bracket
// (bracket.ts), that means:
//   - round 1 pairs Pot 1 with Pot 4 and Pot 2 with Pot 3;
//   - Pot 1 players are spread across the bracket, so they meet each other
//     as late as possible;
//   - when the field isn't a power of two, the byes go to the top seeds,
//     Pot 1 first.
// Who lands where within a pot is random.

import { type BracketNode, generateSingleElim, nextPowerOfTwo } from './bracket.ts';

export const MIN_PLAYERS = 4;

export type PoolEntry = { playerId: string; pot: number; rating: number };

// Uniform in [0, 1).
export type Rng = () => number;

export const cryptoRng: Rng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

// Fisher–Yates: every order equally likely.
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Seed order: each pot shuffled, Pot 1 first.
export function seedsFromPots(pool: readonly PoolEntry[], rng: Rng = cryptoRng): PoolEntry[] {
  const pots = [...new Set(pool.map((p) => p.pot))].sort((a, b) => a - b);
  return pots.flatMap((pot) => shuffle(pool.filter((p) => p.pot === pot), rng));
}

export type Draw = {
  size: number; // bracket size, a power of two
  participants: (PoolEntry & { seed: number })[];
  nodes: BracketNode[];
};

export function makeDraw(pool: readonly PoolEntry[], rng: Rng = cryptoRng): Draw {
  if (pool.length < MIN_PLAYERS) throw new Error(`A tournament needs at least ${MIN_PLAYERS} players`);
  if (new Set(pool.map((p) => p.playerId)).size !== pool.length) throw new Error('A player is in the draw twice');
  const seeded = seedsFromPots(pool, rng);
  const ids = seeded.map((p) => p.playerId);
  return {
    size: nextPowerOfTwo(ids.length),
    participants: seeded.map((p, i) => ({ ...p, seed: i + 1 })),
    nodes: generateSingleElim(ids),
  };
}

// A player's first match still to play: the opponent when known, otherwise
// the two players whose match decides it (after a round-1 bye).
export type FirstMatch = {
  round: number;
  opponent: string | null;
  winnerOf: [string, string] | null;
};

export function firstMatch(nodes: readonly BracketNode[], playerId: string): FirstMatch | null {
  const mine = nodes
    .filter((n) => n.status !== 'completed' && (n.playerA === playerId || n.playerB === playerId))
    .sort((a, b) => a.round - b.round)[0];
  if (!mine) return null;
  const isA = mine.playerA === playerId;
  const opponent = isA ? mine.playerB : mine.playerA;
  if (opponent) return { round: mine.round, opponent, winnerOf: null };
  // Side A of a match is fed by slot 2s of the round before, side B by 2s + 1.
  const feeder = nodes.find((n) => n.round === mine.round - 1 && n.slot === mine.slot * 2 + (isA ? 1 : 0));
  const winnerOf: [string, string] | null =
    feeder?.playerA && feeder.playerB ? [feeder.playerA, feeder.playerB] : null;
  return { round: mine.round, opponent: null, winnerOf };
}
