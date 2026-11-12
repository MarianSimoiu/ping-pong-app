// Run with: deno test supabase/functions/_shared
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { announceDraw, startTournament } from './kickoff.ts';
import type { PushMessage } from './messages.ts';

type Row = Record<string, unknown>;
type RpcResult = { data?: unknown; error?: { message: string; code: string } | null };

// Just enough of the Supabase client for kickoff.ts: filtered selects over
// in-memory tables, and a scripted kickoff_tournament RPC.
function fakeDb(tables: Record<string, Row[]>, rpc: (payload: Row) => RpcResult) {
  const payloads: Row[] = [];
  const client = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const rows = () => (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => (filters.push([column, value]), query),
        maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
        single: () => Promise.resolve({ data: rows()[0], error: rows()[0] ? null : { message: 'none' } }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null }),
      };
      return query;
    },
    rpc(name: string, args: { payload: Row }) {
      assertEquals(name, 'kickoff_tournament');
      payloads.push(args.payload);
      const { data = null, error = null } = rpc(args.payload);
      return Promise.resolve({ data, error });
    },
  };
  return { client: client as unknown as SupabaseClient, payloads };
}

const past = new Date(Date.now() - 60e3).toISOString();
const future = new Date(Date.now() + 3600e3).toISOString();
const pool = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    tournament_id: 't1',
    player_id: `p${i + 1}`,
    pot: i < n / 2 ? 1 : 2,
    rating: 1700 - i * 10,
  }));

Deno.test('starts a due tournament: every registered player drawn, bracket sent to the database', async () => {
  const db = fakeDb(
    { tournaments: [{ id: 't1', status: 'registration', kickoff_at: past }], tournament_live_pots: pool(6) },
    () => ({ data: true }),
  );
  assertEquals(await startTournament(db.client, 't1', null), { started: true });
  const [payload] = db.payloads as {
    started_by: string | null;
    size: number;
    participants: { player_id: string; seed: number; pot: number; rating: number }[];
    nodes: { round: number; status: string }[];
  }[];
  assertEquals(payload.started_by, null);
  assertEquals(payload.size, 8);
  assertEquals(payload.participants.map((p) => p.player_id).sort(), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  assertEquals(payload.participants.map((p) => p.seed), [1, 2, 3, 4, 5, 6]);
  assertEquals(payload.participants.slice(0, 3).every((p) => p.pot === 1), true, 'Pot 1 takes the top seeds');
  assertEquals(payload.nodes.length, 7);
});

Deno.test("won't start: not due (unless an admin starts it), too few players, not open", async () => {
  const notDue = fakeDb(
    { tournaments: [{ id: 't1', status: 'registration', kickoff_at: future }], tournament_live_pots: pool(4) },
    () => ({ data: true }),
  );
  assertEquals(await startTournament(notDue.client, 't1', null), { started: false, reason: "It isn't kickoff time yet" });
  assertEquals(notDue.payloads.length, 0);
  assertEquals(await startTournament(notDue.client, 't1', 'admin-1'), { started: true });
  assertEquals((notDue.payloads[0] as { started_by: string }).started_by, 'admin-1');

  const three = fakeDb(
    { tournaments: [{ id: 't1', status: 'registration', kickoff_at: past }], tournament_live_pots: pool(3) },
    () => ({ data: true }),
  );
  assertEquals(await startTournament(three.client, 't1', null), {
    started: false,
    reason: 'A tournament needs at least 4 players to start',
  });
  assertEquals(three.payloads.length, 0);

  for (const [status, reason] of [
    ['active', 'This tournament has already started'],
    ['cancelled', 'This tournament was cancelled'],
  ]) {
    const db = fakeDb({ tournaments: [{ id: 't1', status, kickoff_at: past }] }, () => ({ data: true }));
    assertEquals(await startTournament(db.client, 't1', null), { started: false, reason });
  }
  const missing = fakeDb({}, () => ({ data: true }));
  assertEquals(await startTournament(missing.client, 'nope', null), { started: false, reason: 'Tournament not found' });
});

Deno.test('registrations changed during the draw: drawn again with the new field', async () => {
  const tables = { tournaments: [{ id: 't1', status: 'registration', kickoff_at: past }], tournament_live_pots: pool(4) };
  let calls = 0;
  const db = fakeDb(tables, () => {
    calls++;
    if (calls === 1) {
      tables.tournament_live_pots = pool(5); // someone registered meanwhile
      return { error: { message: 'Registrations changed during the draw', code: '40001' } };
    }
    return { data: true };
  });
  assertEquals(await startTournament(db.client, 't1', null), { started: true });
  assertEquals(db.payloads.length, 2);
  assertEquals((db.payloads[1] as { participants: unknown[] }).participants.length, 5);
});

Deno.test('another call started it first: nothing more to do', async () => {
  const db = fakeDb(
    { tournaments: [{ id: 't1', status: 'registration', kickoff_at: past }], tournament_live_pots: pool(4) },
    () => ({ data: false }),
  );
  assertEquals(await startTournament(db.client, 't1', null), {
    started: false,
    reason: 'This tournament has already started',
  });
});

Deno.test("the database's rules come back as errors (code P0001)", async () => {
  const db = fakeDb(
    { tournaments: [{ id: 't1', status: 'registration', kickoff_at: future }], tournament_live_pots: pool(4) },
    () => ({ error: { message: 'Only admins can start a tournament early', code: 'P0001' } }),
  );
  const err = await assertRejects(() => startTournament(db.client, 't1', 'not-admin'));
  assertEquals((err as unknown as { code: string }).code, 'P0001');
  // A changed field three times in a row gives up rather than looping.
  const busy = fakeDb(
    { tournaments: [{ id: 't1', status: 'registration', kickoff_at: past }], tournament_live_pots: pool(4) },
    () => ({ error: { message: 'Registrations changed during the draw', code: '40001' } }),
  );
  await assertRejects(() => startTournament(busy.client, 't1', null));
  assertEquals(busy.payloads.length, 3);
});

Deno.test('the draw announcement tells each player who they play first, by name', async () => {
  const name = (id: string) => ({ Ana: 'Ana', Ben: 'Ben', Cris: 'Cris', Dan: 'Dan', Eva: 'Eva' })[id]!;
  const participants = ['Ana', 'Ben', 'Cris', 'Dan', 'Eva'].map((id) => ({
    tournament_id: 't1',
    player_id: id,
    player: { display_name: name(id) },
  }));
  // 5 players: Ana (seed 1) has a bye and waits for Dan v Eva; Ben and Cris
  // had byes too and already meet in round 2.
  const node = (round: number, slot: number, a: string | null, b: string | null, status: string, winner: string | null = null) => ({
    tournament_id: 't1',
    round,
    slot,
    player_a: a,
    player_b: b,
    winner_id: winner,
    status,
  });
  const db = fakeDb(
    {
      tournaments: [{ id: 't1', name: 'Winter Cup' }],
      tournament_participants: participants,
      tournament_matches: [
        node(1, 0, 'Ana', null, 'completed', 'Ana'),
        node(1, 1, 'Dan', 'Eva', 'ready'),
        node(1, 2, 'Ben', null, 'completed', 'Ben'),
        node(1, 3, 'Cris', null, 'completed', 'Cris'),
        node(2, 0, 'Ana', null, 'pending'),
        node(2, 1, 'Ben', 'Cris', 'ready'),
        node(3, 0, null, null, 'pending'),
      ],
    },
    () => ({}),
  );
  const sent: { playerId: string; message: PushMessage }[] = [];
  await announceDraw(db.client, 't1', (_admin, notes) => (sent.push(...notes), Promise.resolve()));
  const body = (id: string) => sent.find((n) => n.playerId === id)?.message.body;
  assertEquals(sent.length, 5);
  assertEquals(body('Ana'), 'You have a bye in round 1, then you play the winner of Dan v Eva.');
  assertEquals(body('Ben'), 'You have a bye in round 1, then you play Cris.');
  assertEquals(body('Dan'), 'Round 1: you play Eva. Good luck!');
  assert(sent.every((n) => n.message.title === 'Winter Cup: the draw is out' && n.message.url === '/tournaments/t1'));

  // A database failure is logged, never thrown.
  await announceDraw(fakeDb({}, () => ({})).client, 'missing', () => Promise.reject(new Error('not reached')));
});
