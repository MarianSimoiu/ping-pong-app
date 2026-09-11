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
      'id, player_a, player_b, winner_id, created_by, ' +
        'creator:players!matches_created_by_fkey(display_name), ' +
        'games:match_games(score_a, score_b)',
    )
    .eq('status', 'pending')
    .neq('created_by', myPlayerId)
    .or(`player_a.eq.${myPlayerId},player_b.eq.${myPlayerId}`)
    .order('played_at', { ascending: false });
  if (error) throw error;

  return (data ?? []).map((m: any) => {
    const creator = Array.isArray(m.creator) ? m.creator[0] : m.creator;
    const iAmA = m.player_a === myPlayerId;
    let myGames = 0;
    let opponentGames = 0;
    for (const g of m.games ?? []) {
      const myScore = iAmA ? g.score_a : g.score_b;
      const oppScore = iAmA ? g.score_b : g.score_a;
      if (myScore > oppScore) myGames += 1;
      else opponentGames += 1;
    }
    return {
      matchId: m.id,
      submitterName: creator?.display_name ?? 'Someone',
      iWon: m.winner_id === myPlayerId,
      myGames,
      opponentGames,
    };
  });
}

// Confirm or decline a pending match (only the opponent may act).
export async function confirmMatch(
  matchId: string,
  action: 'confirm' | 'decline',
): Promise<{ status: string }> {
  if (DEMO) return demo.demoConfirm(matchId, action);
  const { data, error } = await supabase.functions.invoke<{ status: string }>('confirm-match', {
    body: { matchId, action },
  });
  if (error) {
    const message = (data as { error?: string } | null)?.error ?? error.message;
    throw new Error(message);
  }
  if (!data) throw new Error('No response from confirm-match');
  return data;
}
