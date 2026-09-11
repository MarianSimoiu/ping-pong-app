import { MIN_MATCHES_FOR_LEADERBOARD } from '@/lib/constants';
import * as demo from '@/lib/demo';
import { DEMO } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import type { PlayerWithRating } from '@/lib/types';

export type LeaderboardEntry = {
  rank: number;
  playerId: string;
  displayName: string;
  rating: number;
  rd: number;
  matchesPlayed: number;
};

// Ranked skill leaderboard: players past the min-matches gate, best rating first.
export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  if (DEMO) return demo.demoLeaderboard();
  const { data, error } = await supabase
    .from('player_ratings')
    .select('rating, rd, matches_played, player:players(id, display_name)')
    .gte('matches_played', MIN_MATCHES_FOR_LEADERBOARD)
    .order('rating', { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row: any, i) => {
    const player = Array.isArray(row.player) ? row.player[0] : row.player;
    return {
      rank: i + 1,
      playerId: player.id,
      displayName: player.display_name,
      rating: row.rating,
      rd: row.rd,
      matchesPlayed: row.matches_played,
    };
  });
}

export type SeasonEntry = {
  rank: number;
  playerId: string;
  displayName: string;
  points: number;
  events: number;
};

// WTA-style season standings: best-N non-expired results summed per player.
export async function fetchSeasonStandings(): Promise<SeasonEntry[]> {
  if (DEMO) return demo.demoSeasonStandings();
  const { data, error } = await supabase.rpc('season_standings', { best_n: 8 });
  if (error) throw error;
  return (data ?? []).map((r: any, i: number) => ({
    rank: i + 1,
    playerId: r.player_id,
    displayName: r.display_name,
    points: Number(r.points),
    events: r.events,
  }));
}

// A single player's current season points (sum of best-8 non-expired results).
export async function fetchPlayerSeasonPoints(playerId: string): Promise<number> {
  if (DEMO) return demo.demoPlayerSeasonPoints(playerId);
  const { data, error } = await supabase
    .from('season_points')
    .select('points, expires_at')
    .eq('player_id', playerId)
    .gt('expires_at', new Date().toISOString())
    .order('points', { ascending: false })
    .limit(8);
  if (error) throw error;
  return (data ?? []).reduce((sum: number, r: any) => sum + r.points, 0);
}

// A single player's profile card (player row + current rating).
export async function fetchPlayerById(playerId: string): Promise<PlayerWithRating | null> {
  if (DEMO) return demo.demoPlayerById(playerId);
  const { data, error } = await supabase
    .from('players')
    .select('*, rating:player_ratings(*)')
    .eq('id', playerId)
    .single();
  if (error) throw error;
  if (!data) return null;
  const rating = Array.isArray(data.rating) ? data.rating[0] ?? null : data.rating ?? null;
  return { ...data, rating } as PlayerWithRating;
}

export type HistoryPoint = { at: string; rating: number };

// Rating over time, oldest first — for the profile chart.
export async function fetchRatingHistory(playerId: string): Promise<HistoryPoint[]> {
  if (DEMO) return demo.demoRatingHistory(playerId);
  const { data, error } = await supabase
    .from('rating_events')
    .select('created_at, rating_after')
    .eq('player_id', playerId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ at: r.created_at, rating: r.rating_after }));
}

// Win/loss record from the rating audit log.
export async function fetchRecord(playerId: string): Promise<{ wins: number; losses: number }> {
  if (DEMO) return demo.demoRecord(playerId);
  const [wins, losses] = await Promise.all([
    supabase
      .from('rating_events')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', playerId)
      .eq('result', 'win'),
    supabase
      .from('rating_events')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', playerId)
      .eq('result', 'loss'),
  ]);
  if (wins.error) throw wins.error;
  if (losses.error) throw losses.error;
  return { wins: wins.count ?? 0, losses: losses.count ?? 0 };
}

export type MatchHistoryItem = {
  id: string;
  opponentName: string;
  result: 'win' | 'loss';
  delta: number;
  ratingAfter: number;
  at: string;
};

// Recent matches for a player, newest first, derived from the rating audit log.
export async function fetchMatchHistory(playerId: string, limit = 25): Promise<MatchHistoryItem[]> {
  if (DEMO) return demo.demoMatchHistory(playerId).slice(0, limit);
  const { data, error } = await supabase
    .from('rating_events')
    .select(
      'id, result, delta, rating_after, created_at, opponent:players!rating_events_opponent_id_fkey(display_name)',
    )
    .eq('player_id', playerId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((r: any) => {
    const opponent = Array.isArray(r.opponent) ? r.opponent[0] : r.opponent;
    return {
      id: r.id,
      opponentName: opponent?.display_name ?? 'Unknown',
      result: r.result,
      delta: r.delta,
      ratingAfter: r.rating_after,
      at: r.created_at,
    };
  });
}
