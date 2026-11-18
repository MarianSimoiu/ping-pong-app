// WTA-style season points (pure, testable).
//
// A SEPARATE number from the Glicko-2 skill rating. Points are awarded for how
// far a player advanced in a tournament, weighted by the tournament's tier, and
// a player's standing is the sum of their best-N results within a rolling
// 52-week window (older results expire). See docs/RATING.md §4.

import { type BracketNode, isThirdPlace } from './bracket.ts';

// How many best results count toward a player's season standing.
export const BEST_N = 8;

// Rolling window length: results expire after this many days.
export const WINDOW_DAYS = 364; // 52 weeks

// Base points for a tier-1 event by how far a player got. Champion is special;
// the array is indexed by "rounds from the final" for players who lost:
// 0 = lost the final (runner-up), 1 = lost the semifinal, etc.
const CHAMPION_POINTS = 100;
const LOSER_POINTS = [60, 36, 18, 9, 4]; // runner-up, SF, QF, R16, R32
const DEEP_ROUND_POINTS = 2; // earlier exits
// The semifinal losers play for third place (migration 0030): the winner gets
// more than a semifinal's points, the loser (fourth) keeps them.
const THIRD_PLACE_POINTS = 45;

// Where a semifinal loser finished, once the third-place match is decided.
export type ThirdPlaceFinish = 'won' | 'lost';

export type Placement = {
  playerId: string;
  lostRound: number | null; // null => champion
  thirdPlace?: ThirdPlaceFinish; // played the third-place match (lostRound is their semifinal)
};

// Points for a placement in a `totalRounds` bracket at the given tier
// (tier is a linear multiplier: tier 2 pays double a tier-1 event).
export function placementPoints(
  lostRound: number | null,
  totalRounds: number,
  tier: number,
  thirdPlace?: ThirdPlaceFinish,
): number {
  if (lostRound === null) return Math.round(CHAMPION_POINTS * tier);
  if (thirdPlace === 'won') return Math.round(THIRD_PLACE_POINTS * tier);
  const fromEnd = totalRounds - lostRound;
  const base = fromEnd < LOSER_POINTS.length ? LOSER_POINTS[fromEnd] : DEEP_ROUND_POINTS;
  return Math.round(base * tier);
}

export function placementLabel(lostRound: number | null, totalRounds: number, thirdPlace?: ThirdPlaceFinish): string {
  if (lostRound === null) return 'Champion';
  if (thirdPlace === 'won') return 'Third place';
  if (thirdPlace === 'lost') return 'Fourth place';
  const fromEnd = totalRounds - lostRound;
  if (fromEnd === 0) return 'Runner-up';
  if (fromEnd === 1) return 'Semifinalist';
  if (fromEnd === 2) return 'Quarterfinalist';
  if (fromEnd === 3) return 'Round of 16';
  return `Round ${lostRound}`;
}

// From a completed single-elim bracket, determine every participant's finish.
// A player loses one real match (byes don't count) on the way: where they
// went out; the champion wins the final. The semifinal losers' third-place
// match, when played, says which of them was third and which fourth (their
// lostRound stays their semifinal). Returns one Placement per participant.
export function computePlacements(nodes: BracketNode[], totalRounds: number): Placement[] {
  const finish = new Map<string, number | null>();

  for (const n of nodes) {
    if (n.status !== 'completed' || !n.winner) continue;
    if (isThirdPlace(n.round, n.slot, totalRounds)) continue; // below
    // Only real matches (two players) produce a loser; byes are skipped.
    if (n.playerA && n.playerB) {
      const loser = n.winner === n.playerA ? n.playerB : n.playerA;
      finish.set(loser, n.round);
    }
  }

  const final = nodes.find((n) => n.round === totalRounds && !isThirdPlace(n.round, n.slot, totalRounds));
  if (final?.winner) finish.set(final.winner, null); // champion overrides

  const third = new Map<string, ThirdPlaceFinish>();
  const match = nodes.find(
    (n) => isThirdPlace(n.round, n.slot, totalRounds) && n.status === 'completed' && n.winner && n.playerA && n.playerB,
  );
  if (match) {
    third.set(match.winner!, 'won');
    third.set(match.winner === match.playerA ? match.playerB! : match.playerA!, 'lost');
  }

  return [...finish.entries()].map(([playerId, lostRound]) => {
    const thirdPlace = third.get(playerId);
    return thirdPlace ? { playerId, lostRound, thirdPlace } : { playerId, lostRound };
  });
}
