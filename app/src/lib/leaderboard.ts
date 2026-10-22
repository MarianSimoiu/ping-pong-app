import { MIN_MATCHES_FOR_LEADERBOARD } from '@/lib/constants';
import * as demo from '@/lib/demo';
import { DEMO } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import type { PlayerWithRating } from '@/lib/types';

export type LeaderboardEntry = {
  rank: number;
  playerId: string;
  displayName: string;
  avatarUrl: string | null;
  rating: number;
  rd: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
};

// Ranked skill leaderboard: players past the min-matches gate, best rating first.
export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  if (DEMO) return demo.demoLeaderboard();
  const { data, error } = await supabase
    .from('player_ratings')
    .select('rating, rd, matches_played, player:players(id, display_name, avatar_url)')
    .gte('matches_played', MIN_MATCHES_FOR_LEADERBOARD)
    .order('rating', { ascending: false });
  if (error) throw error;

  const entries = (data ?? []).map((row: any, i) => {
    const player = Array.isArray(row.player) ? row.player[0] : row.player;
    return {
      rank: i + 1,
      playerId: player.id,
      displayName: player.display_name,
      avatarUrl: player.avatar_url ?? null,
      rating: row.rating,
      rd: row.rd,
      matchesPlayed: row.matches_played,
      wins: 0,
      losses: 0,
    };
  });
  if (entries.length === 0) return entries;

  // One extra query for everyone's win/loss record, counted in the database
  // (player_records view): one row per player, so no row cap to run into.
  const { data: records, error: recordsError } = await supabase
    .from('player_records')
    .select('player_id, wins, losses')
    .in('player_id', entries.map((e) => e.playerId));
  if (recordsError) throw recordsError;

  const byPlayer = new Map((records ?? []).map((r: any) => [r.player_id as string, r]));
  for (const entry of entries) {
    const record = byPlayer.get(entry.playerId);
    if (record) {
      entry.wins = record.wins;
      entry.losses = record.losses;
    }
  }

  return entries;
}

export type SeasonEntry = {
  rank: number;
  playerId: string;
  displayName: string;
  avatarUrl: string | null;
  points: number;
  events: number;
};

// WTA-style season standings: best-N non-expired results summed per player.
export async function fetchSeasonStandings(): Promise<SeasonEntry[]> {
  if (DEMO) return demo.demoSeasonStandings();
  const { data, error } = await supabase.rpc('season_standings', { best_n: 8 });
  if (error) throw error;
  const rows: any[] = data ?? [];
  if (rows.length === 0) return [];

  // The season_standings RPC doesn't return avatars; one extra query adds them.
  const { data: pics, error: picsError } = await supabase
    .from('players')
    .select('id, avatar_url')
    .in('id', rows.map((r) => r.player_id));
  if (picsError) throw picsError;
  const avatars = new Map<string, string | null>((pics ?? []).map((p: any) => [p.id, p.avatar_url]));

  return rows.map((r, i) => ({
    rank: i + 1,
    playerId: r.player_id,
    displayName: r.display_name,
    avatarUrl: avatars.get(r.player_id) ?? null,
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
  opponentAvatarUrl: string | null;
  result: 'win' | 'loss';
  delta: number;
  ratingAfter: number;
  at: string;
  // Per-set scores, from this player's perspective, in play order.
  games: { myScore: number; opponentScore: number }[];
};

// Recent matches for a player, newest first, derived from the rating audit log.
export async function fetchMatchHistory(playerId: string, limit = 25): Promise<MatchHistoryItem[]> {
  if (DEMO) return demo.demoMatchHistory(playerId).slice(0, limit);
  const { data, error } = await supabase
    .from('rating_events')
    .select(
      'id, result, delta, rating_after, created_at, ' +
        'opponent:players!rating_events_opponent_id_fkey(display_name, avatar_url), ' +
        'match:matches(player_a, games:match_games(game_no, score_a, score_b))',
    )
    .eq('player_id', playerId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((r: any) => {
    const opponent = Array.isArray(r.opponent) ? r.opponent[0] : r.opponent;
    const match = Array.isArray(r.match) ? r.match[0] : r.match;
    const iAmA = match?.player_a === playerId;
    const games = [...(match?.games ?? [])]
      .sort((a: any, b: any) => a.game_no - b.game_no)
      .map((g: any) => ({
        myScore: iAmA ? g.score_a : g.score_b,
        opponentScore: iAmA ? g.score_b : g.score_a,
      }));
    return {
      id: r.id,
      opponentName: opponent?.display_name ?? 'Unknown',
      opponentAvatarUrl: opponent?.avatar_url ?? null,
      result: r.result,
      delta: r.delta,
      ratingAfter: r.rating_after,
      games,
      at: r.created_at,
    };
  });
}
