// Run with: deno test supabase/functions/_shared
//
// The app shows each pot's rules while registration is open
// (app/src/lib/pots.ts): pot sizes, and what round 1 would hold if the draw
// were made now. These tests keep that in step with the real draw here
// (draw.ts, bracket.ts) and the database's pots (tournament_live_pots, 0012).
import { assertEquals } from 'jsr:@std/assert@1';

import { groupByPot, potSizes, round1ByPot, round1Text } from '../../../app/src/lib/pots.ts';
import { makeDraw } from './draw.ts';

Deno.test('pot sizes match ntile: 4 pots from 8, else 2, top pots bigger', () => {
  assertEquals(potSizes(0), []);
  assertEquals(potSizes(1), [1]);
  assertEquals(potSizes(5), [3, 2]);
  assertEquals(potSizes(7), [4, 3]);
  assertEquals(potSizes(8), [2, 2, 2, 2]);
  assertEquals(potSizes(10), [3, 3, 2, 2]);
  assertEquals(potSizes(80), [20, 20, 20, 20]);
});

Deno.test('round 1 per pot matches the real bracket for 4..100 players', () => {
  for (let n = 4; n <= 100; n++) {
    const sizes = potSizes(n);
    const pool = sizes.flatMap((size, i) => Array.from({ length: size }, (_, j) => ({ playerId: `${i + 1}-${j}`, pot: i + 1, rating: 2000 - i * 100 - j })));
    const draw = makeDraw(pool);
    const potOf = (id: string | null) => (id ? Number(id.split('-')[0]) : 0);
    const actual = sizes.map(() => ({ byes: 0, against: new Map<number, number>() }));
    for (const node of draw.nodes.filter((x) => x.round === 1)) {
      for (const [me, them] of [[node.playerA, node.playerB], [node.playerB, node.playerA]]) {
        if (!me) continue;
        const a = actual[potOf(me) - 1];
        if (!them) a.byes++;
        else a.against.set(potOf(them), (a.against.get(potOf(them)) ?? 0) + 1);
      }
    }
    const expected = round1ByPot(sizes);
    assertEquals(
      expected,
      actual.map((a) => ({ byes: a.byes, against: [...a.against].sort(([x], [y]) => x - y).map(([pot, count]) => ({ pot, count })) })),
      `n=${n}`,
    );
  }
});

Deno.test('round 1 texts', () => {
  const t = (n: number) => potSizes(n).map((size, i) => `P${i + 1}: ${round1Text(i + 1, size, round1ByPot(potSizes(n))[i])}`);
  assertEquals(t(16), ['P1: Each plays someone from Pot 4', 'P2: Each plays someone from Pot 3', 'P3: Each plays someone from Pot 2', 'P4: Each plays someone from Pot 1']);
  assertEquals(t(10)[0], 'P1: All get a bye (skip round 1)');
  assertEquals(t(5)[1], 'P2: They play each other');
  assertEquals(t(6)[0], 'P1: 2 get a bye, 1 plays someone from Pot 2 — the draw decides who');
  assertEquals(t(12), [
    'P1: All get a bye (skip round 1)',
    'P2: 1 gets a bye, 2 play someone from Pot 4 — the draw decides who',
    'P3: 2 play each other, 1 plays someone from Pot 4 — the draw decides who',
    'P4: 2 play someone from Pot 2, 1 plays someone from Pot 3 — the draw decides who',
  ]);
});

Deno.test('ranks follow the pots, best rating first, ties to the earlier registration', () => {
  const groups = groupByPot([
    { playerId: 'c', pot: 2, rating: 1500, registeredAt: '2026-11-12T10:00:00Z' },
    { playerId: 'a', pot: 1, rating: 1700, registeredAt: '2026-11-12T11:00:00Z' },
    { playerId: 'b', pot: 1, rating: 1700, registeredAt: '2026-11-12T09:00:00Z' },
    { playerId: 'd', pot: 2, rating: 1450.4, registeredAt: null },
  ]);
  assertEquals(groups.map((g) => [g.pot, g.rankFrom, g.rankTo, g.ratingLow, g.ratingHigh, g.players.map((p) => `${p.rank}${p.playerId}`).join()]), [
    [1, 1, 2, 1700, 1700, '1b,2a'],
    [2, 3, 4, 1450.4, 1500, '3c,4d'],
  ]);
  // Older tournaments: one group, no pot.
  assertEquals(groupByPot([{ playerId: 'x', pot: null, rating: null, registeredAt: null }])[0].pot, null);
});
