// Run with:  deno test supabase/functions/_shared

import { assertEquals, assertThrows } from 'jsr:@std/assert@1';

import { generateSingleElim, nextPowerOfTwo, parentSlot, seedOrder } from './bracket.ts';

Deno.test('nextPowerOfTwo', () => {
  assertEquals(nextPowerOfTwo(2), 2);
  assertEquals(nextPowerOfTwo(5), 8);
  assertEquals(nextPowerOfTwo(8), 8);
  assertEquals(nextPowerOfTwo(9), 16);
});

Deno.test('seedOrder builds the standard 8-bracket', () => {
  // Recursive seeding: pairs are 1v8, 4v5, 2v7, 3v6.
  assertEquals(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

Deno.test('4 players, no byes: two ready semifinals + a pending final', () => {
  const nodes = generateSingleElim(['p1', 'p2', 'p3', 'p4']);
  const r1 = nodes.filter((n) => n.round === 1);
  const r2 = nodes.filter((n) => n.round === 2);
  assertEquals(r1.length, 2);
  assertEquals(r2.length, 1);
  // Top seed meets bottom seed.
  assertEquals(r1[0].playerA, 'p1');
  assertEquals(r1[0].playerB, 'p4');
  assertEquals(r1.every((n) => n.status === 'ready'), true);
  assertEquals(r2[0].status, 'pending');
});

Deno.test('5 players: three byes, top seeds advance for free', () => {
  const nodes = generateSingleElim(['p1', 'p2', 'p3', 'p4', 'p5']);
  const size = 8;
  assertEquals(nodes.filter((n) => n.round === 1).length, size / 2);

  // Exactly one real (ready) first-round match: p5 vs p4.
  const ready = nodes.filter((n) => n.round === 1 && n.status === 'ready');
  assertEquals(ready.length, 1);
  assertEquals([ready[0].playerA, ready[0].playerB].sort(), ['p4', 'p5']);

  // The other three first-round nodes are byes (completed with a winner).
  const byes = nodes.filter((n) => n.round === 1 && n.status === 'completed');
  assertEquals(byes.length, 3);
  assertEquals(byes.every((n) => n.winner !== null), true);

  // Two seeds paired by byes make one semifinal ready immediately (p3 vs p2).
  const r2ready = nodes.filter((n) => n.round === 2 && n.status === 'ready');
  assertEquals(r2ready.length, 1);
});

Deno.test('parentSlot routes winners correctly', () => {
  assertEquals(parentSlot(1, 0, 2), { round: 2, slot: 0, side: 'a' });
  assertEquals(parentSlot(1, 1, 2), { round: 2, slot: 0, side: 'b' });
  assertEquals(parentSlot(1, 2, 3), { round: 2, slot: 1, side: 'a' });
  assertEquals(parentSlot(2, 0, 2), null); // the final has no parent
});

Deno.test('rejects fewer than 2', () => {
  assertThrows(() => generateSingleElim(['solo']), Error);
});

Deno.test('no upper limit: 80 players make a 128 bracket with 48 byes to the top seeds', () => {
  const ids = Array.from({ length: 80 }, (_, i) => `p${i + 1}`);
  const nodes = generateSingleElim(ids);
  const r1 = nodes.filter((n) => n.round === 1);
  assertEquals(r1.length, 64);
  assertEquals(Math.max(...nodes.map((n) => n.round)), 7);
  const byes = r1.filter((n) => n.status === 'completed');
  assertEquals(byes.length, 48);
  assertEquals(
    byes.map((n) => Number(n.winner!.slice(1))).sort((a, b) => a - b),
    Array.from({ length: 48 }, (_, i) => i + 1),
    'seeds 1-48 get the byes',
  );
  assertEquals(r1.filter((n) => n.status === 'ready').length, 16);
  // Every player appears exactly once in round 1.
  const seen = r1.flatMap((n) => [n.playerA, n.playerB]).filter(Boolean);
  assertEquals(new Set(seen).size, 80);
});
