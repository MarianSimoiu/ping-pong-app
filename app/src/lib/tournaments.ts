import type { RawGameInput } from '@/lib/matches';
import { supabase } from '@/lib/supabase';

export type TournamentStatus = 'draft' | 'active' | 'completed';

export type TournamentSummary = {
  id: string;
  name: string;
  status: TournamentStatus;
  size: number;
  bestOf: number;
  tier: number;
  createdAt: string;
};

export type TournamentParticipant = { playerId: string; seed: number; name: string };

export type TournamentNode = {
  id: string;
  round: number;
  slot: number;
  playerA: string | null;
  playerB: string | null;
  winnerId: string | null;
  status: 'pending' | 'ready' | 'completed';
};

export type TournamentDetail = {
  tournament: TournamentSummary;
  participants: TournamentParticipant[];
  nodes: TournamentNode[];
  nameById: Record<string, string>;
  totalRounds: number;
};

export type PlayerWithRatingRow = { id: string; name: string; rating: number; matchesPlayed: number };

function mapSummary(row: any): TournamentSummary {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    size: row.size,
    bestOf: row.best_of,
    tier: row.tier,
    createdAt: row.created_at,
  };
}

export async function fetchTournaments(): Promise<TournamentSummary[]> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('id, name, status, size, best_of, tier, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapSummary);
}

// Every player with a rating, best first — for participant selection & seeding.
export async function fetchSeedablePlayers(): Promise<PlayerWithRatingRow[]> {
  const { data, error } = await supabase
    .from('player_ratings')
    .select('rating, matches_played, player:players(id, display_name)')
    .order('rating', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => {
    const player = Array.isArray(row.player) ? row.player[0] : row.player;
    return { id: player.id, name: player.display_name, rating: row.rating, matchesPlayed: row.matches_played };
  });
}

export async function fetchTournamentDetail(id: string): Promise<TournamentDetail> {
  const [tRes, pRes, nRes] = await Promise.all([
    supabase.from('tournaments').select('id, name, status, size, best_of, tier, created_at').eq('id', id).single(),
    supabase
      .from('tournament_participants')
      .select('seed, player:players(id, display_name)')
      .eq('tournament_id', id)
      .order('seed', { ascending: true }),
    supabase
      .from('tournament_matches')
      .select('id, round, slot, player_a, player_b, winner_id, status')
      .eq('tournament_id', id)
      .order('round', { ascending: true })
      .order('slot', { ascending: true }),
  ]);
  if (tRes.error) throw tRes.error;
  if (pRes.error) throw pRes.error;
  if (nRes.error) throw nRes.error;

  const participants: TournamentParticipant[] = (pRes.data ?? []).map((row: any) => {
    const player = Array.isArray(row.player) ? row.player[0] : row.player;
    return { playerId: player.id, seed: row.seed, name: player.display_name };
  });
  const nameById: Record<string, string> = {};
  for (const p of participants) nameById[p.playerId] = p.name;

  const nodes: TournamentNode[] = (nRes.data ?? []).map((n: any) => ({
    id: n.id,
    round: n.round,
    slot: n.slot,
    playerA: n.player_a,
    playerB: n.player_b,
    winnerId: n.winner_id,
    status: n.status,
  }));

  const tournament = mapSummary(tRes.data);
  return { tournament, participants, nodes, nameById, totalRounds: Math.log2(tournament.size) };
}

export async function createTournament(input: {
  name: string;
  tier: number;
  bestOf: number;
  participantIds: string[];
}): Promise<{ tournamentId: string }> {
  const { data, error } = await supabase.functions.invoke<{ tournamentId: string }>('create-tournament', {
    body: input,
  });
  if (error) {
    const message = (data as { error?: string } | null)?.error ?? error.message;
    throw new Error(message);
  }
  if (!data) throw new Error('No response from create-tournament');
  return data;
}

export async function recordTournamentMatch(input: {
  tournamentMatchId: string;
  games: RawGameInput[];
}): Promise<{ winnerId: string }> {
  const { data, error } = await supabase.functions.invoke<{ winnerId: string }>('submit-tournament-match', {
    body: input,
  });
  if (error) {
    const message = (data as { error?: string } | null)?.error ?? error.message;
    throw new Error(message);
  }
  if (!data) throw new Error('No response from submit-tournament-match');
  return data;
}
