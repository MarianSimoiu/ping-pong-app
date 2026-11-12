// Starting a tournament: the draw (draw.ts) is made from the live pots and
// stored by the kickoff_tournament RPC (migration 0012), then every player is
// told who they play first. tournament-kickoff does this when the kickoff
// time comes; manage-tournament when an admin presses "Start now".

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import type { BracketNode } from './bracket.ts';
import { firstMatch, makeDraw, MIN_PLAYERS, type Rng } from './draw.ts';
import { type PushMessage, tournamentDrawn } from './messages.ts';
import { notifyEach } from './notify.ts';

export type KickoffOutcome = { started: true } | { started: false; reason: string };

const NOT_WAITING: Record<string, string> = {
  active: 'This tournament has already started',
  completed: 'This tournament is over',
  cancelled: 'This tournament was cancelled',
};

// Makes the draw and starts the tournament. `startedBy` is the admin starting
// it early; without one, the kickoff time must have come. Database errors are
// thrown as supabase-js gives them; a rule the RPC enforces has code P0001.
export async function startTournament(
  admin: SupabaseClient,
  tournamentId: string,
  startedBy: string | null,
  rng?: Rng,
): Promise<KickoffOutcome> {
  const { data: t, error } = await admin
    .from('tournaments')
    .select('status, kickoff_at')
    .eq('id', tournamentId)
    .maybeSingle();
  if (error) throw error;
  if (!t) return { started: false, reason: 'Tournament not found' };
  if (t.status !== 'registration') return { started: false, reason: NOT_WAITING[t.status] ?? 'This tournament is not open' };
  if (!startedBy && new Date(t.kickoff_at).getTime() > Date.now()) {
    return { started: false, reason: "It isn't kickoff time yet" };
  }

  // Someone can register or withdraw while the draw is being made: the
  // database then refuses the draw (serialization_failure) and it's made again.
  for (let attempt = 1;; attempt++) {
    const { data: pool, error: poolError } = await admin
      .from('tournament_live_pots')
      .select('player_id, pot, rating')
      .eq('tournament_id', tournamentId);
    if (poolError) throw poolError;
    if (!pool || pool.length < MIN_PLAYERS) {
      return { started: false, reason: `A tournament needs at least ${MIN_PLAYERS} players to start` };
    }
    const draw = makeDraw(pool.map((p) => ({ playerId: p.player_id, pot: p.pot, rating: p.rating })), rng);
    const payload = {
      tournament_id: tournamentId,
      started_by: startedBy,
      size: draw.size,
      participants: draw.participants.map((p) => ({
        player_id: p.playerId,
        seed: p.seed,
        pot: p.pot,
        rating: p.rating,
      })),
      nodes: draw.nodes.map((n) => ({
        round: n.round,
        slot: n.slot,
        player_a: n.playerA,
        player_b: n.playerB,
        winner_id: n.winner,
        status: n.status,
      })),
    };
    const { data: started, error: rpcError } = await admin.rpc('kickoff_tournament', { payload });
    if (rpcError?.code === '40001' && attempt < 3) continue;
    if (rpcError) throw rpcError;
    return started ? { started: true } : { started: false, reason: 'This tournament has already started' };
  }
}

type Note = { playerId: string; message: PushMessage };

// Tells every player of a tournament that was just drawn who they play
// first. Never throws: the draw stands either way.
export async function announceDraw(
  admin: SupabaseClient,
  tournamentId: string,
  send: (admin: SupabaseClient, notes: Note[]) => Promise<void> = notifyEach,
): Promise<void> {
  try {
    const [tRes, pRes, nRes] = await Promise.all([
      admin.from('tournaments').select('name').eq('id', tournamentId).single(),
      admin.from('tournament_participants').select('player_id, player:players(display_name)').eq('tournament_id', tournamentId),
      admin.from('tournament_matches').select('round, slot, player_a, player_b, winner_id, status').eq('tournament_id', tournamentId),
    ]);
    if (tRes.error) throw tRes.error;
    if (pRes.error) throw pRes.error;
    if (nRes.error) throw nRes.error;

    const names = new Map<string, string>();
    for (const p of pRes.data ?? []) {
      const player = Array.isArray(p.player) ? p.player[0] : p.player;
      names.set(p.player_id, player?.display_name ?? 'your opponent');
    }
    const nameOf = (id: string) => names.get(id) ?? 'your opponent';
    const nodes: BracketNode[] = (nRes.data ?? []).map((n) => ({
      round: n.round,
      slot: n.slot,
      playerA: n.player_a,
      playerB: n.player_b,
      winner: n.winner_id,
      status: n.status,
    }));

    await send(
      admin,
      [...names.keys()].map((playerId) => {
        const first = firstMatch(nodes, playerId);
        return {
          playerId,
          message: tournamentDrawn({
            tournamentId,
            tournament: tRes.data.name,
            round: first?.round ?? 1,
            opponent: first?.opponent ? nameOf(first.opponent) : null,
            winnerOf: first?.winnerOf ? [nameOf(first.winnerOf[0]), nameOf(first.winnerOf[1])] : null,
          }),
        };
      }),
    );
  } catch (e) {
    console.warn('Draw announcement failed', e);
  }
}
