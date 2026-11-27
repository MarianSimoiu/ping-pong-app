// Run with:  deno test supabase/functions/_shared

import { assertEquals, assertThrows } from 'jsr:@std/assert@1';

import { isValidGame, resolveChallengeMatch, resolveFreeformMatch, resolveMatch } from './match.ts';

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

Deno.test('resolveFreeformMatch decides a short 2-0 match', () => {
  const out = resolveFreeformMatch([
    { score_a: 11, score_b: 8 },
    { score_a: 11, score_b: 9 },
  ]);
  assertEquals(out.winner, 'a');
  assertEquals(out.aWins, 2);
  assertEquals(out.bWins, 0);
});

Deno.test('resolveFreeformMatch decides a longer 4-3 marathon', () => {
  const out = resolveFreeformMatch([
    { score_a: 11, score_b: 8 },
    { score_a: 9, score_b: 11 },
    { score_a: 11, score_b: 7 },
    { score_a: 8, score_b: 11 },
    { score_a: 11, score_b: 6 },
    { score_a: 7, score_b: 11 },
    { score_a: 11, score_b: 9 },
  ]);
  assertEquals(out.winner, 'a');
  assertEquals(out.aWins, 4);
  assertEquals(out.bWins, 3);
});

Deno.test('resolveFreeformMatch rejects a tied match', () => {
  assertThrows(
    () =>
      resolveFreeformMatch([
        { score_a: 11, score_b: 8 },
        { score_a: 9, score_b: 11 },
      ]),
    Error,
    'tied',
  );
});

Deno.test('resolveFreeformMatch rejects invalid games, empty input, and over-cap series', () => {
  assertThrows(() => resolveFreeformMatch([{ score_a: 11, score_b: 10 }]), Error);
  assertThrows(() => resolveFreeformMatch([]), Error, 'At least one game');
  const tooMany = Array.from({ length: 22 }, (_, i) =>
    i % 2 === 0 ? { score_a: 11, score_b: 0 } : { score_a: 0, score_b: 11 },
  );
  assertThrows(() => resolveFreeformMatch(tooMany), Error, 'at most');
});

Deno.test('resolveChallengeMatch: a best of 3 is 2–0 or 2–1, a best of 5 is 3–0 to 3–2', () => {
  const w = { score_a: 11, score_b: 7 };
  const l = { score_a: 8, score_b: 11 };
  assertEquals(resolveChallengeMatch(3, [w, w]).winner, 'a');
  assertEquals(resolveChallengeMatch(3, [w, l, w]).aWins, 2);
  assertEquals(resolveChallengeMatch(3, [l, w, l]).winner, 'b');
  assertEquals(resolveChallengeMatch(5, [w, w, w]).winner, 'a');
  assertEquals(resolveChallengeMatch(5, [w, l, l, w, w]).bWins, 2);
  assertThrows(() => resolveChallengeMatch(3, [w]), Error, 'best of 3 ends when someone wins 2 games');
  assertThrows(() => resolveChallengeMatch(3, [w, w, w]), Error, 'not 3–0');
  assertThrows(() => resolveChallengeMatch(5, [w, w]), Error, 'best of 5');
  assertThrows(() => resolveChallengeMatch(5, [w, l, w, l, w, w]), Error, 'not 4–2');
  assertThrows(() => resolveChallengeMatch(7, [w, w, w, w]), Error, 'best of 3 or best of 5');
  assertThrows(() => resolveChallengeMatch(3, [w, l]), Error, 'tied');
});
