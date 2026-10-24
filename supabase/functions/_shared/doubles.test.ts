// Run with: deno test supabase/functions/_shared
import { assertAlmostEquals, assertEquals } from 'jsr:@std/assert@1';

import { computeTeamRatingUpdate, type TeamRow } from './doubles.ts';

const fresh = (id: string): TeamRow => ({
  id,
  rating: 1500,
  rd: 350,
  volatility: 0.06,
  matches_played: 0,
  last_played_at: null,
});

Deno.test('two new teams: the same numbers as two new singles players (RATING.md example C)', () => {
  const u = computeTeamRatingUpdate({ teamA: fresh('A'), teamB: fresh('B'), aWon: true, factor: 1, now: new Date() });
  assertAlmostEquals(u.aAfter.rating, 1662.31, 0.01);
  assertAlmostEquals(u.bAfter.rating, 1337.69, 0.01);
  assertAlmostEquals(u.aAfter.rd, 290.32, 0.01);
});

Deno.test('events and ratings are keyed by team, without the singles-only provisional flag', () => {
  const u = computeTeamRatingUpdate({ teamA: fresh('A'), teamB: fresh('B'), aWon: false, factor: 1, now: new Date() });
  assertEquals(u.events.map((e) => [e.team_id, e.opponent_team_id, e.result]), [
    ['A', 'B', 'loss'],
    ['B', 'A', 'win'],
  ]);
  assertEquals('provisional' in u.events[0], false);
  assertEquals('player_id' in u.events[0], false);
  assertEquals(u.ratings.map((r) => r.team_id), ['A', 'B']);
});

Deno.test('the same-teams repeat factor scales the rating move', () => {
  const full = computeTeamRatingUpdate({ teamA: fresh('A'), teamB: fresh('B'), aWon: true, factor: 1, now: new Date() });
  const half = computeTeamRatingUpdate({ teamA: fresh('A'), teamB: fresh('B'), aWon: true, factor: 0.5, now: new Date() });
  assertAlmostEquals(half.aAfter.rating - 1500, (full.aAfter.rating - 1500) / 2, 1e-9);
  assertEquals(half.events[0].repeat_factor, 0.5);
});
