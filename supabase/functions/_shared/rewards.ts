// Tells players what a match earned them: a promotion to a higher tier
// (tier_changes, recorded by the database when ratings change, migration
// 0014) and new titles (achievements and tournament honours, worked out by
// the database from the match history, migration 0015; achievement_notices
// remembers which were announced). The match functions call announceRewards
// after a rated or confirmed result. Tier drops are recorded but not
// announced.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { type PushMessage, tierPromotion, titlesUnlocked, type Unlock } from './messages.ts';
import { notifyEach } from './notify.ts';
import { nextTier, type Tier, tierRank } from './tiers.ts';

type Note = { playerId: string; message: PushMessage };

// Never throws: a reward that can't be announced must not fail the match.
export async function announceRewards(
  admin: SupabaseClient,
  playerIds: string[],
  send: (admin: SupabaseClient, notes: Note[]) => Promise<void> = notifyEach,
): Promise<void> {
  if (playerIds.length === 0) return;
  await Promise.all([announcePromotions(admin, playerIds, send), announceTitles(admin, playerIds, send)]);
}

async function announcePromotions(
  admin: SupabaseClient,
  playerIds: string[],
  send: (admin: SupabaseClient, notes: Note[]) => Promise<void>,
): Promise<void> {
  try {
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

async function announceTitles(
  admin: SupabaseClient,
  playerIds: string[],
  send: (admin: SupabaseClient, notes: Note[]) => Promise<void>,
): Promise<void> {
  try {
    const [progress, honours, catalog] = await Promise.all([
      admin
        .from('achievement_progress')
        .select('player_id, code, earned_at')
        .in('player_id', playerIds)
        .not('earned_at', 'is', null),
      admin.from('tournament_honours').select('player_id, tournament_id, tournament_name, won').in('player_id', playerIds),
      admin.from('achievements').select('code, name, emoji, description'),
    ]);
    if (progress.error) throw progress.error;
    if (honours.error) throw honours.error;
    if (catalog.error) throw catalog.error;

    // Everything earned, keyed like achievement_notices.
    const earned = new Map<string, { player_id: string; code: string; ref: string; tournament?: string }>();
    const add = (player_id: string, code: string, ref = '', tournament?: string) =>
      earned.set(`${player_id}|${code}|${ref}`, { player_id, code, ref, tournament });
    for (const a of progress.data ?? []) add(a.player_id, a.code);
    for (const h of honours.data ?? []) {
      add(h.player_id, 'finalist');
      if (h.won) add(h.player_id, 'champion', h.tournament_id, h.tournament_name);
    }
    if (earned.size === 0) return;

    // Claim them: only the rows this call inserts are new, so each unlock is
    // announced once even if two results land together.
    const { data: claimed, error } = await admin
      .from('achievement_notices')
      .upsert(
        [...earned.values()].map(({ player_id, code, ref }) => ({ player_id, code, ref })),
        { onConflict: 'player_id,code,ref', ignoreDuplicates: true },
      )
      .select('player_id, code, ref');
    if (error) throw error;
    if (!claimed || claimed.length === 0) return;

    const info = new Map((catalog.data ?? []).map((c) => [c.code, c]));
    const perPlayer = new Map<string, Unlock[]>();
    for (const c of claimed) {
      const meta = info.get(c.code);
      if (!meta) continue;
      const tournament = earned.get(`${c.player_id}|${c.code}|${c.ref}`)?.tournament;
      const unlock: Unlock = tournament
        ? { name: `Champion · ${tournament}`, emoji: meta.emoji, description: meta.description, tournament }
        : { name: meta.name, emoji: meta.emoji, description: meta.description };
      perPlayer.set(c.player_id, [...(perPlayer.get(c.player_id) ?? []), unlock]);
    }
    const notes = [...perPlayer].map(([playerId, unlocks]) => ({ playerId, message: titlesUnlocked(unlocks) }));
    if (notes.length > 0) await send(admin, notes);
  } catch (e) {
    console.warn('Titles announcement failed', e);
  }
}
