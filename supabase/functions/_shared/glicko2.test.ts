// Run with:  deno test supabase/functions/_shared
//
// These tests pin the implementation to (a) Glickman's published worked example
// and (b) the exact numbers written into docs/RATING.md, so the code and the doc
// can never silently drift apart.

import { assertAlmostEquals, assertEquals } from 'jsr:@std/assert@1';

import {
  applyInactivity,
  applyRepeatFactor,
  defaultRating,
  isProvisional,
  repeatFactor,
  updatePeriod,
  updateRating,
  type Rating,
} from './glicko2.ts';

Deno.test("Glickman's canonical example (1500/200/0.06 vs three opponents)", () => {
  const player: Rating = { rating: 1500, rd: 200, volatility: 0.06 };
  const result = updatePeriod(player, [
    { opponent: { rating: 1400, rd: 30, volatility: 0.06 }, score: 1 },
    { opponent: { rating: 1550, rd: 100, volatility: 0.06 }, score: 0 },
    { opponent: { rating: 1700, rd: 300, volatility: 0.06 }, score: 0 },
  ]);

  // Published expected values: 1464.06 / 151.52 / 0.05999.
  assertAlmostEquals(result.rating, 1464.06, 0.1);
  assertAlmostEquals(result.rd, 151.52, 0.1);
  assertAlmostEquals(result.volatility, 0.05999, 0.0001);
});

Deno.test('a win raises rating, a loss lowers it, and RD shrinks either way', () => {
  const a = defaultRating(); // 1500 / 350 / 0.06
  const b = defaultRating();

  const win = updateRating(a, b, 1);
  const loss = updateRating(a, b, 0);

  // Symmetric even opponents: equal-and-opposite rating move.
  assertAlmostEquals(win.rating, 1500 + (1500 - loss.rating), 0.001);
  assertEquals(win.rating > 1500, true);
  assertEquals(loss.rating < 1500, true);
  // Playing a game reduces uncertainty.
  assertEquals(win.rd < 350, true);
  assertEquals(loss.rd < 350, true);
});

Deno.test('beating a much weaker opponent barely moves an established rating', () => {
  // Established (low RD) strong player vs weak opponent.
  const strong: Rating = { rating: 1800, rd: 60, volatility: 0.06 };
  const weak: Rating = { rating: 1200, rd: 60, volatility: 0.06 };

  const afterWin = updateRating(strong, weak, 1);
  const afterLoss = updateRating(strong, weak, 0);

  // Expected win: tiny gain. Upset loss: large drop. This is what makes
  // farming weak opponents pointless.
  assertEquals(afterWin.rating - 1800 < 5, true);
  assertEquals(1800 - afterLoss.rating > 20, true);
});

Deno.test('repeatFactor damps repeated same-day games', () => {
  assertEquals(repeatFactor(0), 1); // 1st game today
  assertEquals(repeatFactor(1), 1); // 2nd
  assertEquals(repeatFactor(2), 0.5); // 3rd
  assertEquals(repeatFactor(3), 0.25); // 4th
  assertEquals(repeatFactor(4), 0); // 5th
  assertEquals(repeatFactor(9), 0); // way beyond
});

Deno.test('applyRepeatFactor scales the rating move but keeps the RD update', () => {
  const before: Rating = { rating: 1500, rd: 350, volatility: 0.06 };
  const after = updateRating(before, before, 1);
  const damped = applyRepeatFactor(before, after, 0);

  assertAlmostEquals(damped.rating, before.rating, 1e-9); // zero factor => no move
  assertEquals(damped.rd, after.rd); // but RD still tightened
});

Deno.test('applyInactivity grows RD but never past the default', () => {
  const settled: Rating = { rating: 1600, rd: 80, volatility: 0.06 };
  const idle = applyInactivity(settled, 20);
  assertEquals(idle.rd > 80, true);
  assertEquals(idle.rd <= 350, true);
  assertEquals(idle.rating, 1600); // rating unchanged by inactivity
});

Deno.test('isProvisional flips at 10 matches', () => {
  assertEquals(isProvisional(0), true);
  assertEquals(isProvisional(9), true);
  assertEquals(isProvisional(10), false);
});
