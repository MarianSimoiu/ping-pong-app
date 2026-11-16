// Run with: deno test supabase/functions/_shared
import { assertEquals } from 'jsr:@std/assert@1';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import type { PushMessage } from './messages.ts';
import { announceRegistration } from './registration.ts';

type Row = Record<string, unknown>;
type Note = { playerId: string; message: PushMessage };

// Just enough of the Supabase client for registration.ts: filtered selects
// over in-memory tables.
function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const rows = () => (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => (filters.push([column, value]), query),
        single: () => Promise.resolve({ data: rows()[0] ?? null, error: rows()[0] ? null : { message: 'none' } }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null }),
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

const tables = () => ({
  tournaments: [{ id: 't1', name: 'Winter Cup' }],
  players: [
    { id: 'p1', display_name: 'Ana' },
    { id: 'p2', display_name: 'Ben' },
    { id: 'boss', display_name: 'Organizer' },
  ],
  tournament_participants: [
    { tournament_id: 't1', player_id: 'p2' },
    { tournament_id: 't1', player_id: 'p1' }, // just registered
    { tournament_id: 'other', player_id: 'p9' },
  ],
  admins: [{ player_id: 'boss' }, { player_id: 'p2' }],
});

const capture = () => {
  const sent: Note[] = [];
  return { sent, send: (_admin: SupabaseClient, notes: Note[]) => (sent.push(...notes), Promise.resolve()) };
};

Deno.test('a sign-up is pushed to every admin: who, and how many are in now', async () => {
  const { sent, send } = capture();
  await announceRegistration(fakeDb(tables()), 't1', 'p1', send);
  assertEquals(sent.map((n) => n.playerId).sort(), ['boss', 'p2']);
  assertEquals(sent[0].message, {
    title: 'Winter Cup: Ana registered',
    body: '2 players registered so far.',
    url: '/tournaments/t1',
    tag: 'registered-t1-p1',
  });
});

Deno.test('only admins hear about it, and an admin signing up is not told about themselves', async () => {
  const { sent, send } = capture();
  await announceRegistration(fakeDb(tables()), 't1', 'p2', send);
  assertEquals(sent.map((n) => n.playerId), ['boss']);
  assertEquals(sent[0].message.title, 'Winter Cup: Ben registered');
});

Deno.test('nobody to tell: no admins, or the only admin is the one who signed up', async () => {
  for (const admins of [[], [{ player_id: 'p1' }]]) {
    const { sent, send } = capture();
    await announceRegistration(fakeDb({ ...tables(), admins }), 't1', 'p1', send);
    assertEquals(sent, []);
  }
});

Deno.test('never throws: a lookup that fails, or a failing send, leaves the registration alone', async () => {
  const { sent, send } = capture();
  await announceRegistration(fakeDb(tables()), 'missing', 'p1', send);
  assertEquals(sent, []);
  await announceRegistration(fakeDb(tables()), 't1', 'p1', () => Promise.reject(new Error('push service down')));
});
