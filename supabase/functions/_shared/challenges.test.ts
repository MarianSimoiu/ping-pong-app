import { assertAlmostEquals, assertEquals } from 'jsr:@std/assert@1';

import { boostLabel, challengeBoost } from './challenges.ts';
import { computeRatingUpdate, type RatingRow } from './engine.ts';

const row = (id: string, rating: number, rd = 65, matches = 40): RatingRow => ({
  player_id: id,
  rating,
  rd,
  volatility: 0.06,
  matches_played: matches,
  last_played_at: null,
});

Deno.test('the boost by challenge wins already that week: +25%, +50%, then double', () => {
  assertEquals([0, 1, 2].map(challengeBoost), [1.25, 1.5, 2]);
  assertEquals(challengeBoost(5), 2, 'never more than double');
  assertEquals(challengeBoost(-1), 1.25);
  assertEquals([1.25, 1.5, 2].map(boostLabel), ['+25%', '+50%', '×2']);
});

Deno.test("a challenge win's boost scales the winner's gain only; the loss counts as usual", () => {
  const now = new Date('2026-11-25T12:00:00Z');
  const base = computeRatingUpdate({ aRow: row('a', 1500), bRow: row('b', 1520), aWon: true, factor: 1, now });
  const gain = base.aAfter.rating - base.aBefore.rating;
  const loss = base.bAfter.rating - base.bBefore.rating;
  for (const boost of [1.25, 1.5, 2]) {
    const u = computeRatingUpdate({ aRow: row('a', 1500), bRow: row('b', 1520), aWon: true, factor: 1, now, boost: { a: boost } });
    assertAlmostEquals(u.aAfter.rating - u.aBefore.rating, gain * boost, 1e-9);
    assertAlmostEquals(u.bAfter.rating - u.bBefore.rating, loss, 1e-9);
    assertEquals(u.aAfter.rd, base.aAfter.rd, 'RD as usual');
    assertEquals(u.events[0].challenge_multiplier, boost);
    assertEquals(u.events[1].challenge_multiplier, null);
    assertAlmostEquals(u.events[0].delta as number, gain * boost, 1e-9);
  }
  assertEquals(base.events[0].challenge_multiplier, null, 'no boost: none stored');
});

Deno.test('the boost goes on top of the repeat-opponent damping', () => {
  const now = new Date('2026-11-25T12:00:00Z');
  const full = computeRatingUpdate({ aRow: row('a', 1500), bRow: row('b', 1500), aWon: false, factor: 1, now });
  const u = computeRatingUpdate({ aRow: row('a', 1500), bRow: row('b', 1500), aWon: false, factor: 0.5, now, boost: { b: 2 } });
  assertAlmostEquals(u.bAfter.rating - u.bBefore.rating, full.bAfter.rating - full.bBefore.rating, 1e-9);
  assertAlmostEquals(u.aAfter.rating - u.aBefore.rating, (full.aAfter.rating - full.aBefore.rating) * 0.5, 1e-9);
});
