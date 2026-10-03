import * as demo from '@/lib/demo';
import { DEMO } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import type { OpponentOption, PendingMatch, SubmitMatchResult } from '@/lib/types';

export type RawGameInput = { score_a: number; score_b: number };

// Everyone except the signed-in user, as opponent options.
export async function fetchOpponents(myUserId: string): Promise<OpponentOption[]> {
  if (DEMO) return demo.demoOpponents();
  const { data, error } = await supabase
    .from('players')
    .select('id, display_name')
    .neq('user_id', myUserId)
    .order('display_name');
  if (error) throw error;
  return (data ?? []) as OpponentOption[];
}

// Record a match by invoking the server-side Edge Function (which computes and
// writes ratings). Scores are from the caller's perspective: a = you, b = them.
export async function submitMatch(input: {
  opponentId: string;
  bestOf: number;
  games: RawGameInput[];
}): Promise<SubmitMatchResult> {
  if (DEMO) return demo.demoSubmitMatch();
  const { data, error } = await supabase.functions.invoke<SubmitMatchResult>('submit-match', {
    body: input,
  });
  if (error) {
    // Surface the function's JSON error message when present.
    const message = (data as { error?: string } | null)?.error ?? error.message;
    throw new Error(message);
  }
  if (!data) throw new Error('No response from submit-match');
  return data;
}

// Pending casual matches the given player must confirm (logged by the opponent).
export async function fetchPendingConfirmations(myPlayerId: string): Promise<PendingMatch[]> {
  if (DEMO) return demo.demoPending();
  const { data, error } = await supabase
    .from('matches')
    .select(
      'id, player_a, player_b, winner_id, created_by, played_at, ' +
        'creator:players!matches_created_by_fkey(display_name, avatar_url), ' +
        'games:match_games(game_no, score_a, score_b)',
    )
    .eq('status', 'pending')
    .neq('created_by', myPlayerId)
    .or(`player_a.eq.${myPlayerId},player_b.eq.${myPlayerId}`)
    .order('played_at', { ascending: false });
  if (error) throw error;

  return (data ?? []).map((m: any) => {
    const creator = Array.isArray(m.creator) ? m.creator[0] : m.creator;
    const iAmA = m.player_a === myPlayerId;
    const orderedGames = [...(m.games ?? [])].sort((a, b) => a.game_no - b.game_no);

    let myGames = 0;
    let opponentGames = 0;
    const games = orderedGames.map((g) => {
      const myScore = iAmA ? g.score_a : g.score_b;
      const opponentScore = iAmA ? g.score_b : g.score_a;
      if (myScore > opponentScore) myGames += 1;
      else opponentGames += 1;
      return { myScore, opponentScore };
    });

    return {
      matchId: m.id,
      submitterName: creator?.display_name ?? 'Someone',
      submitterAvatarUrl: creator?.avatar_url ?? null,
      iWon: m.winner_id === myPlayerId,
      myGames,
      opponentGames,
      games,
      submittedAt: m.played_at,
    };
  });
}

// Confirm or decline a pending match (only the opponent may act).
export type ConfirmMatchResult = {
  status: string;
  you?: { delta: number; rating: number; rd: number };
};

export async function confirmMatch(
  matchId: string,
  action: 'confirm' | 'decline',
): Promise<ConfirmMatchResult> {
  if (DEMO) return demo.demoConfirm(matchId, action);
  const { data, error } = await supabase.functions.invoke<ConfirmMatchResult>('confirm-match', {
    body: { matchId, action },
  });
  if (error) {
    const message = (data as { error?: string } | null)?.error ?? error.message;
    throw new Error(message);
  }
  if (!data) throw new Error('No response from confirm-match');
  return data;
}
