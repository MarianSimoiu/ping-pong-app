// Telling players when their tournament matches are (migration 0018 gives
// the times), and the admins when one wasn't played.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { matchOverdue, matchScheduled, type PushMessage } from './messages.ts';
import { notifyEach } from './notify.ts';
import { clubDate, clubDayStart, matchName } from './rounds.ts';

type Note = { playerId: string; message: PushMessage };
type Send = (admin: SupabaseClient, notes: Note[]) => Promise<void>;

// What the app asks match-schedule for (pure, testable). The database checks
// the rules themselves (who, when, no clash on the table).
export type ScheduleRequest =
  | { action: 'propose' | 'move'; matchId: string; at: string }
  | { action: 'accept' | 'decline' | 'withdraw'; matchId: string }
  | { action: 'dates'; tournamentId: string; round: number; startsOn: string; endsOn: string }
  | { action: 'walkover'; matchId: string; winnerId: string };

export const ADMIN_ACTIONS = ['move', 'dates', 'walkover'] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function parseScheduleRequest(
  body: Record<string, unknown>,
): { ok: true; value: ScheduleRequest } | { ok: false; error: string } {
  const action = body.action;
  if (action === 'dates') {
    const tournamentId = text(body.tournamentId);
    const round = body.round;
    const startsOn = text(body.startsOn);
    const endsOn = text(body.endsOn);
    if (!tournamentId) return { ok: false, error: 'tournamentId is required' };
    if (typeof round !== 'number' || !Number.isInteger(round) || round < 1) return { ok: false, error: 'Which round?' };
    if (!startsOn || !DAY.test(startsOn) || !endsOn || !DAY.test(endsOn)) return { ok: false, error: 'Pick the first and last day' };
    return { ok: true, value: { action, tournamentId, round, startsOn, endsOn } };
  }
  const matchId = text(body.tournamentMatchId);
  if (!matchId) return { ok: false, error: 'tournamentMatchId is required' };
  if (action === 'propose' || action === 'move') {
    const at = typeof body.at === 'string' ? new Date(body.at) : null;
    if (!at || Number.isNaN(at.getTime())) return { ok: false, error: 'Pick a day and a time' };
    return { ok: true, value: { action, matchId, at: at.toISOString() } };
  }
  if (action === 'accept' || action === 'decline' || action === 'withdraw') return { ok: true, value: { action, matchId } };
  if (action === 'walkover') {
    const winnerId = text(body.winnerId);
    if (!winnerId) return { ok: false, error: 'Who goes through?' };
    return { ok: true, value: { action, matchId, winnerId } };
  }
  return { ok: false, error: 'action must be propose, accept, decline, withdraw, move, dates or walkover' };
}

async function names(admin: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const { data, error } = await admin.from('players').select('id, display_name').in('id', ids);
  if (error) throw error;
  return new Map((data ?? []).map((p: { id: string; display_name: string }) => [p.id, p.display_name]));
}

// Tells both players of each match in the tournament that got a time (or a
// new one) they haven't been told: claimed first, so two calls can't both
// send it. `skip` already knows (the player who just accepted the time);
// `moved` for a time that changed. Never throws.
export async function announceSchedules(
  admin: SupabaseClient,
  tournamentId: string,
  opts: { skip?: string; moved?: boolean } = {},
  send: Send = notifyEach,
): Promise<void> {
  try {
    const { data: claimed, error } = await admin
      .from('tournament_matches')
      .update({ schedule_announced: true })
      .eq('tournament_id', tournamentId)
      .eq('schedule_announced', false)
      .eq('status', 'ready')
      .not('scheduled_at', 'is', null)
      .select('round, player_a, player_b, scheduled_at');
    if (error) throw error;
    if (!claimed || claimed.length === 0) return;

    const { data: t, error: tError } = await admin.from('tournaments').select('name, size').eq('id', tournamentId).single();
    if (tError) throw tError;
    const total = Math.log2(t.size);
    const nameOf = await names(admin, claimed.flatMap((m) => [m.player_a, m.player_b]));

    const notes: Note[] = [];
    for (const m of claimed) {
      for (const [me, them] of [[m.player_a, m.player_b], [m.player_b, m.player_a]] as [string, string][]) {
        if (me === opts.skip) continue;
        notes.push({
          playerId: me,
          message: matchScheduled({
            tournamentId,
            tournament: t.name,
            match: matchName(m.round, total),
            opponent: nameOf.get(them) ?? 'your opponent',
            at: m.scheduled_at,
            moved: !!opts.moved,
          }),
        });
      }
    }
    if (notes.length > 0) await send(admin, notes);
  } catch (e) {
    console.warn('Schedule announcement failed', e);
  }
}

// Tells the admins about every match still not played the day after its
// date (once each). Never throws.
export async function announceOverdue(admin: SupabaseClient, now = new Date(), send: Send = notifyEach): Promise<void> {
  try {
    const todayStarts = clubDayStart(clubDate(now)).toISOString();
    const { data: claimed, error } = await admin
      .from('tournament_matches')
      .update({ overdue_notified: true })
      .eq('status', 'ready')
      .eq('overdue_notified', false)
      .lt('scheduled_at', todayStarts)
      .select('tournament_id, round, player_a, player_b, scheduled_at');
    if (error) throw error;
    if (!claimed || claimed.length === 0) return;

    const [{ data: admins, error: aError }, { data: tournaments, error: tError }] = await Promise.all([
      admin.from('admins').select('player_id'),
      admin.from('tournaments').select('id, name, size').in('id', [...new Set(claimed.map((m) => m.tournament_id))]),
    ]);
    if (aError) throw aError;
    if (tError) throw tError;
    const byId = new Map((tournaments ?? []).map((t: { id: string; name: string; size: number }) => [t.id, t]));
    const nameOf = await names(admin, claimed.flatMap((m) => [m.player_a, m.player_b]));

    const notes: Note[] = [];
    for (const m of claimed) {
      const t = byId.get(m.tournament_id);
      if (!t) continue;
      const message = matchOverdue({
        tournamentId: m.tournament_id,
        tournament: t.name,
        match: matchName(m.round, Math.log2(t.size)),
        playerA: nameOf.get(m.player_a) ?? '?',
        playerB: nameOf.get(m.player_b) ?? '?',
        at: m.scheduled_at,
      });
      for (const a of admins ?? []) notes.push({ playerId: a.player_id, message });
    }
    if (notes.length > 0) await send(admin, notes);
  } catch (e) {
    console.warn('Overdue announcement failed', e);
  }
}
