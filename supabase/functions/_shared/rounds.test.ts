// Run with: deno test supabase/functions/_shared
import { assertEquals } from 'jsr:@std/assert@1';

import { clubDate, clubDayStart, clubTime, matchName, roundName } from './rounds.ts';

Deno.test('round names count back from the final', () => {
  assertEquals([1, 2, 3, 4].map((r) => roundName(r, 4)), ['Round of 16', 'Quarterfinals', 'Semifinals', 'Final']);
  assertEquals([1, 2].map((r) => roundName(r, 6)), ['Round 1', 'Round of 32']);
  assertEquals([1, 2].map((r) => roundName(r, 2)), ['Semifinals', 'Final']);
  assertEquals([1, 2, 3, 4].map((r) => matchName(r, 4)), ['round of 16 match', 'quarterfinal', 'semifinal', 'final']);
  assertEquals(matchName(1, 6), 'round 1 match');
});

Deno.test('times read in Bucharest time, winter and summer', () => {
  assertEquals(clubTime('2026-11-16T09:00:00Z'), 'Mon 16 Nov, 11:00'); // UTC+2
  assertEquals(clubTime('2026-07-06T08:00:00Z'), 'Mon 6 Jul, 11:00'); // UTC+3
  assertEquals(clubTime('2026-11-16T15:45:00Z'), 'Mon 16 Nov, 17:45');
  assertEquals(clubTime('2026-11-15T22:30:00Z'), 'Mon 16 Nov, 00:30'); // already Monday there
});

Deno.test('a club day starts at midnight Bucharest time', () => {
  assertEquals(clubDayStart('2026-11-16').toISOString(), '2026-11-15T22:00:00.000Z');
  assertEquals(clubDayStart('2026-07-06').toISOString(), '2026-07-05T21:00:00.000Z');
  assertEquals(clubDayStart('2026-03-29').toISOString(), '2026-03-28T22:00:00.000Z'); // the clocks go forward at 03:00
  assertEquals(clubDayStart('2026-10-25').toISOString(), '2026-10-24T21:00:00.000Z'); // and back at 04:00
  assertEquals(clubDate(new Date('2026-11-15T22:00:00Z')), '2026-11-16');
  assertEquals(clubDate(new Date('2026-11-15T21:59:00Z')), '2026-11-15');
});
