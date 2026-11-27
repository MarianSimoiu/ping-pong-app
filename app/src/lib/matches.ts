import * as demo from '@/lib/demo';
import { DEMO } from '@/lib/env';
import { functionErrorMessage, supabase } from '@/lib/supabase';
import type { OpponentOption, PendingMatch, SubmitMatchResult, SubmittedPendingMatch } from '@/lib/types';

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
// A challenge match (0031) says its format: best of 3 or 5, as the two agreed.
export async function submitMatch(input: {
  opponentId: string;
  games: RawGameInput[];
  challenge?: { bestOf: number } | null;
}): Promise<SubmitMatchResult> {
  if (DEMO) return demo.demoSubmitMatch(input);
  const { data, error } = await supabase.functions.invoke<SubmitMatchResult>('submit-match', {
    body: input,
  });
  if (error) throw new Error(await functionErrorMessage(error));
  if (!data) throw new Error('No response from submit-match');
  return data;
}

// A tournament result's tournament, by the matches' own link to it.
const TOURNAMENT = 'context, tournament:tournaments!matches_tournament_fk(id, name)';
const tournamentOf = (m: any): { id: string; name: string } | null => {
  const t = Array.isArray(m.tournament) ? m.tournament[0] : m.tournament;
  return m.context === 'tournament' && t ? { id: t.id, name: t.name } : null;
};
// A challenge match's format (0031).
const challengeOf = (m: any): { bestOf: number } | null => (m.challenge ? { bestOf: m.best_of } : null);

// Pending matches the given player must confirm (logged by the opponent):
// casual ones, and tournament results (0028).
export async function fetchPendingConfirmations(myPlayerId: string): Promise<PendingMatch[]> {
  if (DEMO) return demo.demoPending();
  const { data, error } = await supabase
    .from('matches')
    .select(
      'id, player_a, player_b, winner_id, created_by, played_at, challenge, best_of, ' +
        'creator:players!matches_created_by_fkey(display_name, avatar_url), ' +
        'games:match_games(game_no, score_a, score_b), ' +
        TOURNAMENT,
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
      submitterId: m.created_by,
      submitterName: creator?.display_name ?? 'Someone',
      submitterAvatarUrl: creator?.avatar_url ?? null,
      iWon: m.winner_id === myPlayerId,
      myGames,
      opponentGames,
      games,
      submittedAt: m.played_at,
      tournament: tournamentOf(m),
      challenge: challengeOf(m),
    };
  });
}

// Matches the given player submitted that are still awaiting their
// opponent's confirmation. A casual one has the submitter as player_a
// (submit-match records the caller's own side as a); a tournament result
// keeps the bracket's sides, so the submitter may be either.
export async function fetchSubmittedPending(myPlayerId: string): Promise<SubmittedPendingMatch[]> {
  if (DEMO) return demo.demoSubmittedPending();
  const { data, error } = await supabase
    .from('matches')
    .select(
      'id, player_a, player_b, winner_id, played_at, challenge, best_of, ' +
        'pa:players!matches_player_a_fkey(display_name, avatar_url), ' +
        'pb:players!matches_player_b_fkey(display_name, avatar_url), ' +
        'games:match_games(game_no, score_a, score_b), ' +
        TOURNAMENT,
    )
    .eq('status', 'pending')
    .eq('created_by', myPlayerId)
    .order('played_at', { ascending: false });
  if (error) throw error;

  return (data ?? []).map((m: any) => {
    const iAmA = m.player_a === myPlayerId;
    const opponent = (x: any) => (Array.isArray(x) ? x[0] : x);
    const them = opponent(iAmA ? m.pb : m.pa);
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
      opponentId: iAmA ? m.player_b : m.player_a,
      opponentName: them?.display_name ?? 'Someone',
      opponentAvatarUrl: them?.avatar_url ?? null,
      iWon: m.winner_id === myPlayerId,
      myGames,
      opponentGames,
      games,
      submittedAt: m.played_at,
      tournament: tournamentOf(m),
      challenge: challengeOf(m),
    };
  });
}

// Confirm or decline a pending match (only the opponent may act).
export type ConfirmMatchResult = {
  status: string;
  // boost: a challenge win's (0031), already in the delta.
  you?: { delta: number; rating: number; rd: number; boost?: number | null };
};

export async function confirmMatch(
  matchId: string,
  action: 'confirm' | 'decline',
): Promise<ConfirmMatchResult> {
  if (DEMO) return demo.demoConfirm(matchId, action);
  const { data, error } = await supabase.functions.invoke<ConfirmMatchResult>('confirm-match', {
    body: { matchId, action },
  });
  if (error) throw new Error(await functionErrorMessage(error));
  if (!data) throw new Error('No response from confirm-match');
  return data;
}
