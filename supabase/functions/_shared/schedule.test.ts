// Run with: deno test supabase/functions/_shared
import { assert, assertEquals } from 'jsr:@std/assert@1';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import type { PushMessage } from './messages.ts';
import { announceOverdue, announceSchedules, parseScheduleRequest } from './schedule.ts';

type Row = Record<string, unknown>;
type Note = { playerId: string; message: PushMessage };

// Just enough of the Supabase client for schedule.ts: filtered selects and
// updates (an update with .select() returns the rows it changed).
function fakeDb(tables: Record<string, Row[]>, failOn?: string) {
  const client = {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let patch: Row | null = null;
      const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const run = () => {
        if (table === failOn) return { data: null, error: { message: 'down' } };
        const hit = rows();
        if (patch) for (const r of hit) Object.assign(r, patch);
        return { data: hit, error: null };
      };
      const query = {
        select: () => query,
        update: (p: Row) => ((patch = p), query),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), query),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), query),
        lt: (c: string, v: string) => (filters.push((r) => typeof r[c] === 'string' && (r[c] as string) < v), query),
        not: (c: string, _op: string, _v: unknown) => (filters.push((r) => r[c] !== null && r[c] !== undefined), query),
        single: () => Promise.resolve({ data: run().data?.[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve(run()),
      };
      return query;
    },
  };
  return client as unknown as SupabaseClient;
}

const players = [
  { id: 'ana', display_name: 'Ana' },
  { id: 'ben', display_name: 'Ben' },
  { id: 'cris', display_name: 'Cris' },
  { id: 'dan', display_name: 'Dan' },
];
const match = (id: string, round: number, a: string, b: string, at: string | null, announced: boolean, extra: Row = {}) => ({
  id,
  tournament_id: 't1',
  round,
  player_a: a,
  player_b: b,
  status: 'ready',
  scheduled_at: at,
  schedule_announced: announced,
  overdue_notified: false,
  ...extra,
});

Deno.test('the app\'s requests: what each action needs', () => {
  assertEquals(parseScheduleRequest({ action: 'propose', tournamentMatchId: 'm1', at: '2026-11-16T12:00:00+02:00' }), {
    ok: true,
    value: { action: 'propose', matchId: 'm1', at: '2026-11-16T10:00:00.000Z' },
  });
  assertEquals(parseScheduleRequest({ action: 'propose', tournamentMatchId: 'm1', at: 'soon' }), { ok: false, error: 'Pick a day and a time' });
  assertEquals(parseScheduleRequest({ action: 'accept', tournamentMatchId: ' m1 ' }), { ok: true, value: { action: 'accept', matchId: 'm1' } });
  assertEquals(parseScheduleRequest({ action: 'decline' }), { ok: false, error: 'tournamentMatchId is required' });
  assertEquals(parseScheduleRequest({ action: 'walkover', tournamentMatchId: 'm1' }), { ok: false, error: 'Who goes through?' });
  assertEquals(parseScheduleRequest({ action: 'dates', tournamentId: 't1', round: 2, startsOn: '2026-11-17', endsOn: '2026-11-18' }), {
    ok: true,
    value: { action: 'dates', tournamentId: 't1', round: 2, startsOn: '2026-11-17', endsOn: '2026-11-18' },
  });
  assertEquals(parseScheduleRequest({ action: 'dates', tournamentId: 't1', round: 0, startsOn: '2026-11-17', endsOn: '2026-11-18' }).ok, false);
  assertEquals(parseScheduleRequest({ action: 'dates', tournamentId: 't1', round: 1, startsOn: '17/11', endsOn: '2026-11-18' }), {
    ok: false,
    error: 'Pick the first and last day',
  });
  assertEquals(parseScheduleRequest({ action: 'nap', tournamentMatchId: 'm1' }).ok, false);
});

Deno.test('new match times are told to both players, once', async () => {
  const tables = {
    tournaments: [{ id: 't1', name: 'Winter Cup', size: 8 }],
    players,
    tournament_matches: [
      match('m1', 2, 'ana', 'ben', '2026-11-17T09:00:00Z', false),
      match('m2', 2, 'cris', 'dan', '2026-11-17T09:30:00Z', true), // already told
      match('m3', 3, 'ana', 'cris', null, false), // no time yet
    ],
  };
  const db = fakeDb(tables);
  const sent: Note[] = [];
  const send = (_: SupabaseClient, notes: Note[]) => (sent.push(...notes), Promise.resolve());
  await announceSchedules(db, 't1', {}, send);
  assertEquals(sent.map((n) => [n.playerId, n.message.title, n.message.body]), [
    ['ana', 'Winter Cup: your semifinal', "You play Ben on Tue 17 Nov, 11:00. Can't make it? Propose another time in the app."],
    ['ben', 'Winter Cup: your semifinal', "You play Ana on Tue 17 Nov, 11:00. Can't make it? Propose another time in the app."],
  ]);
  assertEquals(tables.tournament_matches[0].schedule_announced, true);

  // Told already: nothing more.
  await announceSchedules(db, 't1', {}, send);
  assertEquals(sent.length, 2);

  // A moved time, with the player who accepted it left out.
  tables.tournament_matches[1].schedule_announced = false;
  await announceSchedules(db, 't1', { skip: 'cris', moved: true }, send);
  assertEquals(sent.slice(2).map((n) => [n.playerId, n.message.title, n.message.body]), [
    ['dan', 'Winter Cup: your semifinal moved', 'You play Cris on Tue 17 Nov, 11:30 now.'],
  ]);

  // A database failure is logged, never thrown.
  tables.tournament_matches[0].schedule_announced = false;
  await announceSchedules(fakeDb(tables, 'tournament_matches'), 't1', {}, () => Promise.reject(new Error('not reached')));
});

Deno.test('matches not played by the day after their date: every admin is told, once', async () => {
  const now = new Date('2026-11-18T08:00:00Z'); // Wednesday 10:00 in Bucharest
  const tables = {
    admins: [{ player_id: 'dan' }, { player_id: 'cris' }],
    tournaments: [{ id: 't1', name: 'Winter Cup', size: 8 }],
    players,
    tournament_matches: [
      match('m1', 1, 'ana', 'ben', '2026-11-16T09:00:00Z', true), // Monday: overdue
      match('m2', 1, 'cris', 'dan', '2026-11-17T15:00:00Z', true), // yesterday 17:00: overdue
      match('m3', 1, 'ana', 'dan', '2026-11-18T07:00:00Z', true), // today: not yet
      match('m4', 1, 'ben', 'cris', '2026-11-16T09:30:00Z', true, { status: 'completed' }), // played
    ],
  };
  const sent: Note[] = [];
  const send = (_: SupabaseClient, notes: Note[]) => (sent.push(...notes), Promise.resolve());
  await announceOverdue(fakeDb(tables), now, send);
  assertEquals(sent.map((n) => n.playerId), ['dan', 'cris', 'dan', 'cris']);
  assertEquals(sent[0].message.title, "Winter Cup: a match wasn't played");
  assertEquals(sent[0].message.body, 'Ana v Ben (quarterfinal) was due Mon 16 Nov, 11:00. Record the result or give a walkover.');
  assertEquals(sent[2].message.body, 'Cris v Dan (quarterfinal) was due Tue 17 Nov, 17:00. Record the result or give a walkover.');
  assert(tables.tournament_matches.slice(0, 2).every((m) => m.overdue_notified));
  assertEquals(tables.tournament_matches[2].overdue_notified, false);

  await announceOverdue(fakeDb(tables), now, send);
  assertEquals(sent.length, 4, 'told once');
});
