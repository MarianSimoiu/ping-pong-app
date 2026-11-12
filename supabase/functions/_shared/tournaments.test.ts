// Run with: deno test supabase/functions/_shared
import { assertEquals } from 'jsr:@std/assert@1';

import { checkKickoff, checkNewTournament, errorMessage, isRuleError } from './tournaments.ts';

const now = new Date('2026-11-12T10:00:00Z');

Deno.test('kickoff: a real time, in the future, within a year', () => {
  assertEquals(checkKickoff('2026-11-14T18:00:00+02:00', now), { ok: true, value: '2026-11-14T16:00:00.000Z' });
  assertEquals(checkKickoff('2026-11-12T10:00:30Z', now).ok, false, '30 s ahead is too close');
  assertEquals(checkKickoff('2026-11-12T09:00:00Z', now), { ok: false, error: 'Pick a kickoff time in the future' });
  assertEquals(checkKickoff('2027-12-01T10:00:00Z', now), { ok: false, error: 'Pick a kickoff within the next year' });
  for (const bad of [undefined, '', 'tomorrow', 42, null]) {
    assertEquals(checkKickoff(bad, now), { ok: false, error: 'Pick a kickoff date and time' });
  }
});

Deno.test('new tournament: name, best of, tier, kickoff', () => {
  assertEquals(checkNewTournament({ name: '  Winter Cup ', bestOf: 5, kickoffAt: '2026-11-20T17:00:00Z' }, now), {
    ok: true,
    value: { name: 'Winter Cup', bestOf: 5, tier: 1, kickoffAt: '2026-11-20T17:00:00.000Z' },
  });
  assertEquals(checkNewTournament({ name: 'Cup', kickoffAt: '2026-11-20T17:00:00Z' }, now).ok, true, 'best of 3 by default');
  assertEquals(checkNewTournament({ name: ' ', kickoffAt: '2026-11-20T17:00:00Z' }, now), { ok: false, error: 'Give the tournament a name' });
  assertEquals(checkNewTournament({ name: 'x'.repeat(61), kickoffAt: '2026-11-20T17:00:00Z' }, now).ok, false);
  assertEquals(checkNewTournament({ name: 'Cup', bestOf: 4, kickoffAt: '2026-11-20T17:00:00Z' }, now), { ok: false, error: 'Best of 1, 3, 5 or 7' });
  assertEquals(checkNewTournament({ name: 'Cup', bestOf: '3', kickoffAt: '2026-11-20T17:00:00Z' }, now).ok, false);
  assertEquals(checkNewTournament({ name: 'Cup', tier: 9, kickoffAt: '2026-11-20T17:00:00Z' }, now).ok, false);
  assertEquals(checkNewTournament({ name: 'Cup' }, now), { ok: false, error: 'Pick a kickoff date and time' });
});

Deno.test('database errors: message and whether it is a rule meant for the player', () => {
  const rule = { message: 'Registration closed at kickoff', code: 'P0001' };
  assertEquals(errorMessage(rule), 'Registration closed at kickoff');
  assertEquals(isRuleError(rule), true);
  assertEquals(isRuleError({ message: 'deadlock', code: '40P01' }), false);
  assertEquals(errorMessage(new Error('boom')), 'boom');
  assertEquals(errorMessage(undefined), 'Unexpected error');
  assertEquals(isRuleError(null), false);
});
