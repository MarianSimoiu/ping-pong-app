// Run with: deno test supabase/functions/_shared
import { assertEquals } from 'jsr:@std/assert@1';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import type { PushMessage } from './messages.ts';
import { announceRewards } from './rewards.ts';
import { nextTier } from './tiers.ts';

type Row = Record<string, unknown>;

// Just enough of the Supabase client for rewards.ts.
function fakeDb(tables: Record<string, Row[]>) {
  const client = {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let patch: Row | null = null;
      const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const query = {
        select: () => query,
        update: (p: Row) => ((patch = p), query),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), query),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), query),
        order: () => query,
        then: (resolve: (v: unknown) => unknown) => {
          if (patch) {
            for (const r of rows()) Object.assign(r, patch);
            return resolve({ error: null });
          }
          return resolve({ data: rows(), error: null });
        },
      };
      return query;
    },
  };
  return client as unknown as SupabaseClient;
}

const lines = [
  { tier: 'silver', min_rating: 1400 },
  { tier: 'gold', min_rating: 1500 },
  { tier: 'platinum', min_rating: 1600 },
  { tier: 'diamond', min_rating: 1700 },
];
const change = (id: string, player: string, from: string, to: string, at: string) => ({
  id,
  player_id: player,
  from_tier: from,
  to_tier: to,
  changed_at: at,
  notified: false,
});

Deno.test('next tier', () => {
  assertEquals(nextTier('gold', lines), { tier: 'platinum', rating: 1600 });
  assertEquals(nextTier('bronze', lines), { tier: 'silver', rating: 1400 });
  assertEquals(nextTier('diamond', lines), null);
  assertEquals(nextTier('unranked', lines), null);
});

Deno.test('promotions are announced once; drops are not', async () => {
  const tables = {
    tier_lines: lines,
    tier_changes: [
      change('1', 'ana', 'silver', 'gold', '2026-11-12T10:00:00Z'),
      change('2', 'ben', 'gold', 'silver', '2026-11-12T10:00:00Z'),
      change('3', 'cris', 'unranked', 'bronze', '2026-11-12T10:00:00Z'),
      change('4', 'dan', 'gold', 'platinum', '2026-11-12T10:00:00Z'),
      change('5', 'dan', 'platinum', 'diamond', '2026-11-12T10:05:00Z'),
      change('6', 'eva', 'gold', 'platinum', '2026-11-12T10:00:00Z'), // not in this match
    ],
  };
  const sent: { playerId: string; message: PushMessage }[] = [];
  const send = (_: SupabaseClient, notes: typeof sent) => (sent.push(...notes), Promise.resolve());
  const db = fakeDb(tables);
  await announceRewards(db, ['ana', 'ben', 'cris', 'dan'], send);
  assertEquals(sent.map((n) => [n.playerId, n.message.title, n.message.body]), [
    ['ana', 'Promoted to Gold 🥇', 'Next up: Platinum at 1600.'],
    ['cris', "You're placed in Bronze 🥉", 'Next up: Silver at 1400.'],
    ['dan', 'Promoted to Diamond 💎', 'The top tier. Top the leaderboard to become Legend.'],
  ]);
  assertEquals(sent[0].message.url, '/profile');
  assertEquals(tables.tier_changes.map((c) => c.notified), [true, true, true, true, true, false]);
  // A second call sends nothing.
  sent.length = 0;
  await announceRewards(db, ['ana', 'ben', 'cris', 'dan'], send);
  assertEquals(sent.length, 0);
});

Deno.test('a drop then back up within one match is not news', async () => {
  const tables = {
    tier_lines: lines,
    tier_changes: [
      change('1', 'ana', 'gold', 'silver', '2026-11-12T10:00:00Z'),
      change('2', 'ana', 'silver', 'gold', '2026-11-12T10:01:00Z'),
    ],
  };
  const sent: unknown[] = [];
  await announceRewards(fakeDb(tables), ['ana'], (_, notes) => (sent.push(...notes), Promise.resolve()));
  assertEquals(sent.length, 0);
});

Deno.test('never throws', async () => {
  const broken = { from: () => { throw new Error('db down'); } } as unknown as SupabaseClient;
  await announceRewards(broken, ['ana']);
  await announceRewards(fakeDb({}), []);
});
