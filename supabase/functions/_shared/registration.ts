// Telling the admins about tournament sign-ups (tournament-registration).

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { type PushMessage, tournamentRegistered } from './messages.ts';
import { notifyEach } from './notify.ts';

type Note = { playerId: string; message: PushMessage };
type Send = (admin: SupabaseClient, notes: Note[]) => Promise<void>;

// After a player registers: every admin hears who it was and how many are in
// now (not the player themselves, if they're an admin). Never throws: the
// registration stands either way.
export async function announceRegistration(
  admin: SupabaseClient,
  tournamentId: string,
  playerId: string,
  send: Send = notifyEach,
): Promise<void> {
  try {
    const [tRes, pRes, inRes, aRes] = await Promise.all([
      admin.from('tournaments').select('name').eq('id', tournamentId).single(),
      admin.from('players').select('display_name').eq('id', playerId).single(),
      admin.from('tournament_participants').select('player_id').eq('tournament_id', tournamentId),
      admin.from('admins').select('player_id'),
    ]);
    if (tRes.error) throw tRes.error;
    if (pRes.error) throw pRes.error;
    if (inRes.error) throw inRes.error;
    if (aRes.error) throw aRes.error;

    const to = (aRes.data ?? []).map((a: { player_id: string }) => a.player_id).filter((id) => id !== playerId);
    if (to.length === 0) return;
    const message = tournamentRegistered({
      tournamentId,
      tournament: tRes.data.name,
      player: pRes.data.display_name,
      playerId,
      count: (inRes.data ?? []).length,
    });
    await send(admin, to.map((id) => ({ playerId: id, message })));
  } catch (e) {
    console.warn('Registration notice failed', e);
  }
}
