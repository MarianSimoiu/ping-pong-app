// Season points for a finished tournament: every player's placement from the
// bracket (points.ts), stored by the award_season_points RPC. Used when the
// final is recorded (submit-tournament-match) or given as a walkover
// (match-schedule).

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { computePlacements, placementLabel, placementPoints, WINDOW_DAYS } from './points.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

// Returns whether points were awarded (false if the tournament isn't over).
export async function awardSeasonPoints(admin: SupabaseClient, tournamentId: string): Promise<boolean> {
  const { data: finished } = await admin.from('tournaments').select('status, tier, size').eq('id', tournamentId).single();
  if (finished?.status !== 'completed') return false;

  const { data: allNodes } = await admin
    .from('tournament_matches')
    .select('round, slot, player_a, player_b, winner_id, status')
    .eq('tournament_id', tournamentId);
  const totalRounds = Math.log2(finished.size);
  const bracketNodes = (allNodes ?? []).map((n: any) => ({
    round: n.round,
    slot: n.slot,
    playerA: n.player_a,
    playerB: n.player_b,
    winner: n.winner_id,
    status: n.status,
  }));
  const placements = computePlacements(bracketNodes, totalRounds);
  const expiresAt = new Date(Date.now() + WINDOW_DAYS * DAY_MS).toISOString();
  const awards = placements.map((p) => ({
    player_id: p.playerId,
    placement: placementLabel(p.lostRound, totalRounds),
    points: placementPoints(p.lostRound, totalRounds, finished.tier),
    expires_at: expiresAt,
  }));
  const { error } = await admin.rpc('award_season_points', { payload: { tournament_id: tournamentId, awards } });
  return !error;
}
