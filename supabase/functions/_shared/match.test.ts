// Run with:  deno test supabase/functions/_shared

import { assertEquals, assertThrows } from 'jsr:@std/assert@1';

import { isValidGame, resolveMatch } from './match.ts';

Deno.test('isValidGame enforces 11-point win-by-2', () => {
  assertEquals(isValidGame({ score_a: 11, score_b: 7 }), true);
  assertEquals(isValidGame({ score_a: 12, score_b: 10 }), true);
  assertEquals(isValidGame({ score_a: 11, score_b: 10 }), false); // margin < 2
  assertEquals(isValidGame({ score_a: 9, score_b: 7 }), false); // below 11
  assertEquals(isValidGame({ score_a: 11.5, score_b: 5 }), false); // non-integer
});

Deno.test('resolveMatch decides a best-of-3 correctly', () => {
  const out = resolveMatch(3, [
    { score_a: 11, score_b: 8 },
    { score_a: 9, score_b: 11 },
    { score_a: 11, score_b: 6 },
  ]);
  assertEquals(out.winner, 'a');
  assertEquals(out.aWins, 2);
  assertEquals(out.bWins, 1);
  assertEquals(out.games[1].winner, 'b');
});

Deno.test('resolveMatch allows an early 2-0 sweep in a best-of-3', () => {
  const out = resolveMatch(3, [
    { score_a: 11, score_b: 4 },
    { score_a: 11, score_b: 9 },
  ]);
  assertEquals(out.winner, 'a');
});

Deno.test('resolveMatch rejects an undecided series', () => {
  assertThrows(() => resolveMatch(3, [{ score_a: 11, score_b: 4 }]), Error, 'not decided');
});

Deno.test('resolveMatch rejects invalid games and overlong series', () => {
  assertThrows(() => resolveMatch(3, [{ score_a: 11, score_b: 10 }]), Error);
  assertThrows(
    () =>
      resolveMatch(1, [
        { score_a: 11, score_b: 4 },
        { score_a: 11, score_b: 4 },
      ]),
    Error,
    'best_of',
  );
});
