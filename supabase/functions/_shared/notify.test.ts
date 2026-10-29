// Run with: deno test supabase/functions/_shared
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { afterResponse, notifyPlayers, vapidKeys } from './notify.ts';

type Row = Record<string, unknown>;

// Just enough of the Supabase client for notify.ts, backed by in-memory tables.
function fakeDb(tables: Record<string, Row[]>, opts: { failSelect?: boolean } = {}) {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      const rows = (tables[table] ??= []);
      return {
        select() {
          return {
            in: (column: string, values: unknown[]) =>
              Promise.resolve(
                opts.failSelect
                  ? { data: null, error: new Error('db down') }
                  : { data: rows.filter((r) => values.includes(r[column])), error: null },
              ),
            maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
          };
        },
        upsert(row: Row) {
          calls.push(`upsert ${table}`);
          if (rows.length === 0) rows.push(row);
          return Promise.resolve({ error: null });
        },
        delete() {
          return {
            eq: (column: string, value: unknown) => {
              calls.push(`delete ${table} ${value}`);
              tables[table] = rows.filter((r) => r[column] !== value);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, calls, tables };
}

// A real browser key pair's public half and auth secret (any valid ones do).
const device = (id: string, player: string, host: string) => ({
  id,
  player_id: player,
  endpoint: `https://${host}/push/${id}`,
  p256dh: 'BFPX8CCf9a0ekCJD7lSaWutCNLKRm28b4fm5cMmdQc3f5dvclUBLxebZ_8nwUatMcJHJfp-nDuk7Qt7huQIrxuk',
  auth: '0wFq7-WRarRirXY-i7pfGQ',
});

// Replaces fetch for one test: answers by endpoint, records what was sent.
function fakePushServices(statusFor: (url: string) => number | 'throw') {
  const sent: { url: string; headers: Headers; bytes: number }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const status = statusFor(url);
    if (status === 'throw') return Promise.reject(new Error('network down'));
    sent.push({ url, headers: new Headers(init?.headers), bytes: (init?.body as Uint8Array).length });
    return Promise.resolve(new Response(status >= 400 ? 'gone' : null, { status }));
  }) as typeof fetch;
  return { sent, restore: () => (globalThis.fetch = realFetch) };
}

const message = { title: 'Silviu recorded a match', body: 'You lost 1–3. Tap to confirm or decline.', url: '/', tag: 'match-1' };

Deno.test('the server keys are created once, then reused', async () => {
  const db = fakeDb({});
  const first = await vapidKeys(db.client);
  const second = await vapidKeys(db.client);
  assertEquals(first, second);
  assertEquals(db.calls, ['upsert push_keys']);
  assertEquals(db.tables.push_keys.length, 1);
});

Deno.test("sends to every device of the players, and forgets ones that are gone", async () => {
  const db = fakeDb({
    push_subscriptions: [
      device('phone', 'alin', 'fcm.googleapis.com'),
      device('laptop', 'alin', 'updates.push.services.mozilla.com'),
      device('old-iphone', 'alin', 'web.push.apple.com'),
      device('someone-else', 'ana', 'fcm.googleapis.com'),
    ],
  });
  const push = fakePushServices((url) => (url.includes('old-iphone') ? 410 : 201));
  try {
    await notifyPlayers(db.client, ['alin'], message);
  } finally {
    push.restore();
  }
  assertEquals(push.sent.map((s) => new URL(s.url).pathname).sort(), ['/push/laptop', '/push/old-iphone', '/push/phone']);
  for (const s of push.sent) {
    assertEquals(s.headers.get('Content-Encoding'), 'aes128gcm');
    assertEquals(s.headers.get('TTL'), '259200');
    assertMatch(s.headers.get('Authorization') ?? '', /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    assert(s.bytes > 86 + JSON.stringify(message).length, 'encrypted payload with header');
  }
  assertEquals(
    db.tables.push_subscriptions.map((d) => d.id),
    ['phone', 'laptop', 'someone-else'],
    'the expired subscription is deleted',
  );
});

Deno.test('a failing push service or database never throws', async () => {
  const db = fakeDb({ push_subscriptions: [device('phone', 'alin', 'fcm.googleapis.com')] });
  const push = fakePushServices(() => 'throw');
  try {
    await notifyPlayers(db.client, ['alin'], message);
    await notifyPlayers(fakeDb({}, { failSelect: true }).client, ['alin'], message);
    await notifyPlayers(db.client, [], message);
  } finally {
    push.restore();
  }
  assertEquals(db.tables.push_subscriptions.length, 1, 'a network error is not a reason to forget the device');
});

Deno.test('work runs after the response when the runtime allows it', async () => {
  const waited: Promise<unknown>[] = [];
  (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => waited.push(p) };
  try {
    let done = false;
    const slow = new Promise((resolve) => setTimeout(resolve, 20)).then(() => (done = true));
    await afterResponse(slow);
    assertEquals(done, false, "didn't wait");
    assertEquals(waited.length, 1);
    await slow;
  } finally {
    delete (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime;
  }
  let ran = false;
  await afterResponse(Promise.resolve().then(() => (ran = true)));
  assertEquals(ran, true, 'without the runtime it simply waits');
});
