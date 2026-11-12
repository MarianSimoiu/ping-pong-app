// Tells players what a match earned them: a promotion to a higher tier
// (tier_changes, recorded by the database when ratings change, migration
// 0014). The match functions call announceRewards after a rated result.
// Drops are recorded too but not announced.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { type PushMessage, tierPromotion } from './messages.ts';
import { notifyEach } from './notify.ts';
import { nextTier, type Tier, tierRank } from './tiers.ts';

type Note = { playerId: string; message: PushMessage };

// Never throws: a reward that can't be announced must not fail the match.
export async function announceRewards(
  admin: SupabaseClient,
  playerIds: string[],
  send: (admin: SupabaseClient, notes: Note[]) => Promise<void> = notifyEach,
): Promise<void> {
  try {
    if (playerIds.length === 0) return;
    const { data: changes, error } = await admin
      .from('tier_changes')
      .select('id, player_id, from_tier, to_tier, changed_at')
      .in('player_id', playerIds)
      .eq('notified', false)
      .order('changed_at', { ascending: true });
    if (error) throw error;
    if (!changes || changes.length === 0) return;

    // Claimed before sending, so a second call can't announce them again.
    const { error: markError } = await admin
      .from('tier_changes')
      .update({ notified: true })
      .in('id', changes.map((c) => c.id));
    if (markError) throw markError;

    const { data: lines } = await admin.from('tier_lines').select('tier, min_rating');

    // Per player, from where they were before these changes to where they are now.
    const net = new Map<string, { from: Tier; to: Tier }>();
    for (const c of changes) {
      const seen = net.get(c.player_id);
      net.set(c.player_id, { from: seen?.from ?? c.from_tier, to: c.to_tier });
    }
    const notes: Note[] = [];
    for (const [playerId, { from, to }] of net) {
      if (tierRank(to) <= tierRank(from)) continue;
      notes.push({ playerId, message: tierPromotion({ from, to, next: nextTier(to, lines ?? []) }) });
    }
    if (notes.length > 0) await send(admin, notes);
  } catch (e) {
    console.warn('Rewards announcement failed', e);
  }
}
