// Run with: deno test supabase/functions/_shared
import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';

import { cryptoRng, firstMatch, makeDraw, type PoolEntry, seedsFromPots, shuffle } from './draw.ts';

// A seeded generator, so a test can repeat a draw exactly.
function seededRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

// n players named by pot ("1a", "1b", ... "4d"), rating falling with the pot.
function pool(potSizes: number[]): PoolEntry[] {
  return potSizes.flatMap((size, i) =>
    Array.from({ length: size }, (_, j) => ({
      playerId: `${i + 1}${String.fromCharCode(97 + j)}`,
      pot: i + 1,
      rating: 1800 - i * 100 - j,
    }))
  );
}
const potOf = (id: string | null) => (id ? Number(id[0]) : null);

Deno.test('shuffle keeps every item and every order is reachable', () => {
  const rng = seededRng(1);
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const out = shuffle(['a', 'b', 'c'], rng);
    assertEquals([...out].sort(), ['a', 'b', 'c']);
    seen.add(out.join(''));
  }
  assertEquals(seen.size, 6);
});

Deno.test('shuffle is uniform: each player is first about equally often', () => {
  const rng = seededRng(7);
  const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
  const runs = 40000;
  for (let i = 0; i < runs; i++) counts[shuffle(['a', 'b', 'c', 'd'], rng)[0]]++;
  for (const c of Object.values(counts)) assert(Math.abs(c / runs - 0.25) < 0.01, JSON.stringify(counts));
});

Deno.test('the crypto generator stays in [0, 1)', () => {
  for (let i = 0; i < 1000; i++) {
    const x = cryptoRng();
    assert(x >= 0 && x < 1);
  }
});

Deno.test('seeds: Pot 1 first, then Pot 2..., shuffled within each pot', () => {
  const entries = pool([4, 4, 4, 4]);
  const seeds = seedsFromPots([...entries].reverse(), seededRng(3));
  assertEquals(seeds.map((s) => s.pot), [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]);
  // Different runs give different orders within a pot.
  const orders = new Set<string>();
  const rng = seededRng(4);
  for (let i = 0; i < 50; i++) orders.add(seedsFromPots(entries, rng).slice(0, 4).map((s) => s.playerId).join());
  assert(orders.size > 10);
});

Deno.test('16 players in 4 pots: round 1 is Pot 1 v Pot 4 and Pot 2 v Pot 3, Pot 1 spread out', () => {
  const rng = seededRng(11);
  for (let run = 0; run < 200; run++) {
    const draw = makeDraw(pool([4, 4, 4, 4]), rng);
    assertEquals(draw.size, 16);
    const r1 = draw.nodes.filter((n) => n.round === 1);
    for (const n of r1) {
      const pots = [potOf(n.playerA), potOf(n.playerB)].sort();
      assert(String(pots) === '1,4' || String(pots) === '2,3', `round 1 pairs ${pots}`);
    }
    // One Pot 1 player in each quarter of the bracket (round-1 slots 0-1, 2-3, 4-5, 6-7).
    const quarters = r1
      .filter((n) => potOf(n.playerA) === 1 || potOf(n.playerB) === 1)
      .map((n) => Math.floor(n.slot / 2));
    assertEquals([...quarters].sort(), [0, 1, 2, 3]);
  }
});

Deno.test('who meets whom in round 1 is random', () => {
  const rng = seededRng(5);
  const opponentsOf1a = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const r1 = makeDraw(pool([4, 4, 4, 4]), rng).nodes.filter((n) => n.round === 1);
    const node = r1.find((n) => n.playerA === '1a' || n.playerB === '1a')!;
    opponentsOf1a.add(node.playerA === '1a' ? node.playerB! : node.playerA!);
  }
  assertEquals([...opponentsOf1a].sort(), ['4a', '4b', '4c', '4d']);
});

Deno.test('byes go to Pot 1 (then Pot 2) when the field is short', () => {
  // 10 players: pots of 3, 3, 2, 2 -> bracket of 16 with 6 byes.
  const draw = makeDraw(pool([3, 3, 2, 2]), seededRng(9));
  const byes = draw.nodes.filter((n) => n.round === 1 && n.status === 'completed');
  assertEquals(byes.length, 6);
  assertEquals(byes.map((n) => potOf(n.winner)).sort(), [1, 1, 1, 2, 2, 2]);
  // 6 players in 2 pots of 3: two byes, both Pot 1. The third Pot 1 player
  // meets a Pot 2 player; the other two Pot 2 players meet each other.
  const six = makeDraw(pool([3, 3]), seededRng(10));
  const r1 = six.nodes.filter((n) => n.round === 1);
  assertEquals(r1.filter((n) => n.status === 'completed').map((n) => potOf(n.winner)), [1, 1]);
  assertEquals(
    r1.filter((n) => n.status === 'ready').map((n) => String([potOf(n.playerA), potOf(n.playerB)].sort())).sort(),
    ['1,2', '2,2'],
  );
});

Deno.test('participants keep their pot and rating and get seeds 1..n', () => {
  const entries = pool([3, 3, 2, 2]);
  const draw = makeDraw(entries, seededRng(2));
  assertEquals(draw.participants.map((p) => p.seed), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const p of draw.participants) {
    const original = entries.find((e) => e.playerId === p.playerId)!;
    assertEquals([p.pot, p.rating], [original.pot, original.rating]);
  }
});

Deno.test('no upper limit: 80 players', () => {
  const draw = makeDraw(pool([20, 20, 20, 20]), seededRng(12));
  assertEquals(draw.size, 128);
  assertEquals(draw.participants.length, 80);
  const byes = draw.nodes.filter((n) => n.round === 1 && n.status === 'completed');
  assertEquals(byes.length, 48);
  assert(byes.every((n) => (potOf(n.winner) ?? 9) <= 3), 'byes to Pots 1-3 (seeds 1-48)');
});

Deno.test('fewer than 4 players, or a duplicate, is refused', () => {
  assertThrows(() => makeDraw(pool([2, 1])), Error, 'at least 4');
  const dup = pool([2, 2]);
  dup[3] = { ...dup[0], pot: 2 };
  assertThrows(() => makeDraw(dup), Error, 'twice');
});

Deno.test('first match: an opponent, or the winner of the match before after a bye', () => {
  // 6 players: seeds 1 and 2 get byes.
  const draw = makeDraw(pool([3, 3]), seededRng(1));
  const bySeed = (s: number) => draw.participants[s - 1].playerId;
  // Seed 3 meets seed 6 in round 1 (standard seeding for 8: 1v8, 4v5, 2v7, 3v6).
  assertEquals(firstMatch(draw.nodes, bySeed(3)), { round: 1, opponent: bySeed(6), winnerOf: null });
  // Seed 1 had a bye: next is round 2 against the winner of seed 4 v seed 5.
  const top = firstMatch(draw.nodes, bySeed(1))!;
  assertEquals(top.round, 2);
  assertEquals(top.opponent, null);
  assertEquals([...top.winnerOf!].sort(), [bySeed(4), bySeed(5)].sort());
  // 5 players: seeds 2 and 3 both had byes and already meet in round 2.
  const five = makeDraw(pool([3, 2]), seededRng(2));
  const s = (n: number) => five.participants[n - 1].playerId;
  assertEquals(firstMatch(five.nodes, s(2)), { round: 2, opponent: s(3), winnerOf: null });
  assertEquals(firstMatch(five.nodes, 'nobody'), null);
});
