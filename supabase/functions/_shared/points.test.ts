// Run with:  deno test supabase/functions/_shared

import { assertEquals } from 'jsr:@std/assert@1';

import { generateSingleElim, type BracketNode } from './bracket.ts';
import { computePlacements, placementLabel, placementPoints } from './points.ts';

Deno.test('placementPoints scales by round reached and tier', () => {
  const totalRounds = 3; // 8-player bracket
  assertEquals(placementPoints(null, totalRounds, 1), 100); // champion
  assertEquals(placementPoints(3, totalRounds, 1), 60); // lost the final
  assertEquals(placementPoints(2, totalRounds, 1), 36); // lost the semifinal
  assertEquals(placementPoints(1, totalRounds, 1), 18); // lost the quarterfinal
  // Tier doubles everything.
  assertEquals(placementPoints(null, totalRounds, 2), 200);
  assertEquals(placementPoints(3, totalRounds, 2), 120);
});

Deno.test('placementLabel reads naturally', () => {
  assertEquals(placementLabel(null, 3), 'Champion');
  assertEquals(placementLabel(3, 3), 'Runner-up');
  assertEquals(placementLabel(2, 3), 'Semifinalist');
  assertEquals(placementLabel(1, 3), 'Quarterfinalist');
  assertEquals(placementLabel(2, 3, 'won'), 'Third place');
  assertEquals(placementLabel(2, 3, 'lost'), 'Fourth place');
});

Deno.test('the third-place match: 45 for third, a semifinal\'s 36 for fourth', () => {
  assertEquals(placementPoints(2, 3, 1, 'won'), 45);
  assertEquals(placementPoints(2, 3, 1, 'lost'), 36);
  assertEquals(placementPoints(2, 3, 2, 'won'), 90);
});

// Helper: play out a bracket deterministically (player_a always wins).
function playOut(nodes: BracketNode[], totalRounds: number): BracketNode[] {
  const at = (r: number, s: number) => nodes.find((n) => n.round === r && n.slot === s)!;
  for (let r = 1; r <= totalRounds; r++) {
    for (const n of nodes.filter((x) => x.round === r)) {
      if (n.status === 'completed') continue; // bye already resolved
      if (!n.playerA || !n.playerB) continue;
      n.winner = n.playerA;
      n.status = 'completed';
      if (r < totalRounds) {
        const parent = at(r + 1, Math.floor(n.slot / 2));
        if (n.slot % 2 === 0) parent.playerA = n.playerA;
        else parent.playerB = n.playerA;
        if (parent.playerA && parent.playerB) parent.status = 'ready';
      }
    }
  }
  return nodes;
}

Deno.test('computePlacements over a played-out 4-player bracket', () => {
  const nodes = playOut(generateSingleElim(['p1', 'p2', 'p3', 'p4']), 2);
  const places = computePlacements(nodes, 2);
  const byPlayer = Object.fromEntries(places.map((p) => [p.playerId, p.lostRound]));

  // Seeding pairs: (p1,p4) and (p2,p3); player_a always wins => p1 champion.
  assertEquals(byPlayer['p1'], null); // champion
  assertEquals(byPlayer['p2'], 2); // lost the final (round 2)
  assertEquals(byPlayer['p4'], 1); // lost round 1
  assertEquals(byPlayer['p3'], 1); // lost round 1
  assertEquals(places.length, 4); // everyone placed exactly once
  // The third-place match not played (as in tournaments from before it): no third or fourth.
  assertEquals(places.some((p) => p.thirdPlace), false);
});

Deno.test('computePlacements with the third-place match played', () => {
  const nodes = playOut(generateSingleElim(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']), 3);
  // The semifinal losers (p4 lost to p1, p3 to p2) play for third: as the
  // database seats them, side A from the first semifinal, B from the second.
  const third = nodes.find((n) => n.round === 3 && n.slot === 1)!;
  Object.assign(third, { playerA: 'p4', playerB: 'p3', winner: 'p3', status: 'completed' });
  const places = computePlacements(nodes, 3);
  assertEquals(places.length, 8);
  const of = (id: string) => places.find((p) => p.playerId === id)!;
  const points = (id: string) => placementPoints(of(id).lostRound, 3, 1, of(id).thirdPlace);
  const label = (id: string) => placementLabel(of(id).lostRound, 3, of(id).thirdPlace);
  assertEquals(['p1', 'p2', 'p3', 'p4', 'p5'].map(label), ['Champion', 'Runner-up', 'Third place', 'Fourth place', 'Quarterfinalist']);
  assertEquals(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map(points), [100, 60, 45, 36, 18, 18, 18, 18]);
});
