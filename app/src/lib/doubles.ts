import { MIN_MATCHES_FOR_LEADERBOARD } from '@/lib/constants';
import * as demo from '@/lib/demo';
import { DEMO } from '@/lib/env';
import type { RawGameInput } from '@/lib/matches';
import { functionErrorMessage, supabase } from '@/lib/supabase';

// 2v2 doubles, ranked by team: each pair of players is a team with its own
// rating (migration 0010). Reads go straight to the tables; writes go through
// the submit-doubles-match / confirm-doubles-match Edge Functions.

export type TeamMember = { id: string; name: string; avatarUrl: string | null };

export type Team = {
  id: string;
  members: [TeamMember, TeamMember];
  rating: number;
  rd: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
};

export type RankedTeam = Team & { rank: number };

// A pending doubles match, from the viewer's side.
export type DoublesPendingMatch = {
  matchId: string;
  partnerName: string;
  opponentNames: [string, string];
  submitterName: string;
  iWon: boolean; // the viewer's team won
  myGames: number;
  opponentGames: number;
  games: { myScore: number; opponentScore: number }[]; // the viewer's team first
  submittedAt: string;
};

export const teamName = (t: Team) => `${t.members[0].name} & ${t.members[1].name}`;

const TEAM_SELECT =
  'id, rating, rd, matches_played, ' +
  'low:players!teams_player_low_fkey(id, display_name, avatar_url), ' +
  'high:players!teams_player_high_fkey(id, display_name, avatar_url)';

const one = (x: any) => (Array.isArray(x) ? x[0] : x);
const member = (p: any): TeamMember => ({
  id: p?.id ?? '',
  name: p?.display_name ?? 'Someone',
  avatarUrl: p?.avatar_url ?? null,
});

// Team rows + their win/loss records (team_records view), in the given order.
async function withRecords(rows: any[]): Promise<Team[]> {
  if (rows.length === 0) return [];
  const { data: records, error } = await supabase
    .from('team_records')
    .select('team_id, wins, losses')
    .in('team_id', rows.map((r) => r.id));
  if (error) throw error;
  const byTeam = new Map((records ?? []).map((r: any) => [r.team_id as string, r]));
  return rows.map((r) => ({
    id: r.id,
    members: [member(one(r.low)), member(one(r.high))],
    rating: r.rating,
    rd: r.rd,
    matchesPlayed: r.matches_played,
    wins: byTeam.get(r.id)?.wins ?? 0,
    losses: byTeam.get(r.id)?.losses ?? 0,
  }));
}

// Ranked teams: past the min-matches gate, best rating first.
export async function fetchTeamLeaderboard(): Promise<RankedTeam[]> {
  if (DEMO) return demo.demoTeamLeaderboard();
  const { data, error } = await supabase
    .from('teams')
    .select(TEAM_SELECT)
    .gte('matches_played', MIN_MATCHES_FOR_LEADERBOARD)
    .order('rating', { ascending: false });
  if (error) throw error;
  return (await withRecords(data ?? [])).map((t, i) => ({ ...t, rank: i + 1 }));
}

// Every team the player is in, ranked or not.
export async function fetchMyTeams(myPlayerId: string): Promise<Team[]> {
  if (DEMO) return demo.demoMyTeams();
  const { data, error } = await supabase
    .from('teams')
    .select(TEAM_SELECT)
    .or(`player_low.eq.${myPlayerId},player_high.eq.${myPlayerId}`)
    .order('rating', { ascending: false });
  if (error) throw error;
  return withRecords(data ?? []);
}

const PENDING_SELECT =
  'id, team_a, team_b, winner_team, played_at, ' +
  'creator:players!doubles_matches_created_by_fkey(display_name), ' +
  'a:teams!doubles_matches_team_a_fkey(low:players!teams_player_low_fkey(id, display_name), high:players!teams_player_high_fkey(id, display_name)), ' +
  'b:teams!doubles_matches_team_b_fkey(low:players!teams_player_low_fkey(id, display_name), high:players!teams_player_high_fkey(id, display_name)), ' +
  'games:doubles_games(game_no, score_a, score_b)';

// Pending matches on one side: 'b' = waiting for the viewer to confirm (they're
// an opponent), 'a' = the viewer's team recorded it and waits on the opponents.
async function fetchPending(myPlayerId: string, mySide: 'a' | 'b'): Promise<DoublesPendingMatch[]> {
  const { data: myTeams, error: tErr } = await supabase
    .from('teams')
    .select('id')
    .or(`player_low.eq.${myPlayerId},player_high.eq.${myPlayerId}`);
  if (tErr) throw tErr;
  const ids = (myTeams ?? []).map((t: any) => t.id as string);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('doubles_matches')
    .select(PENDING_SELECT)
    .eq('status', 'pending')
    .in(mySide === 'a' ? 'team_a' : 'team_b', ids)
    .order('played_at', { ascending: false });
  if (error) throw error;

  return (data ?? []).map((m: any) => {
    const mine = one(mySide === 'a' ? m.a : m.b);
    const theirs = one(mySide === 'a' ? m.b : m.a);
    const partner = [one(mine?.low), one(mine?.high)].find((p) => p?.id !== myPlayerId);
    const orderedGames = [...(m.games ?? [])].sort((x: any, y: any) => x.game_no - y.game_no);
    let myGames = 0;
    let opponentGames = 0;
    const games = orderedGames.map((g: any) => {
      const myScore = mySide === 'a' ? g.score_a : g.score_b;
      const opponentScore = mySide === 'a' ? g.score_b : g.score_a;
      if (myScore > opponentScore) myGames += 1;
      else opponentGames += 1;
      return { myScore, opponentScore };
    });
    return {
      matchId: m.id,
      partnerName: partner?.display_name ?? 'Someone',
      opponentNames: [one(theirs?.low)?.display_name ?? '?', one(theirs?.high)?.display_name ?? '?'],
      submitterName: one(m.creator)?.display_name ?? 'Someone',
      iWon: m.winner_team === (mySide === 'a' ? m.team_a : m.team_b),
      myGames,
      opponentGames,
      games,
      submittedAt: m.played_at,
    };
  });
}

// Matches the other team recorded, waiting for the player (an opponent) to confirm.
export async function fetchDoublesToConfirm(myPlayerId: string): Promise<DoublesPendingMatch[]> {
  if (DEMO) return demo.demoDoublesToConfirm();
  return fetchPending(myPlayerId, 'b');
}

// Matches the player's team recorded, waiting for one of the opponents.
export async function fetchDoublesAwaitingOpponents(myPlayerId: string): Promise<DoublesPendingMatch[]> {
  if (DEMO) return demo.demoDoublesAwaitingOpponents();
  return fetchPending(myPlayerId, 'a');
}

// Scores are from the caller's team's side: a = you and your partner.
export async function submitDoublesMatch(input: {
  partnerId: string;
  opponentIds: [string, string];
  games: RawGameInput[];
}): Promise<{ matchId: string; status: 'pending' }> {
  if (DEMO) return demo.demoSubmitDoublesMatch();
  const { data, error } = await supabase.functions.invoke<{ matchId: string; status: 'pending' }>(
    'submit-doubles-match',
    { body: input },
  );
  if (error) throw new Error(await functionErrorMessage(error));
  if (!data) throw new Error('No response from submit-doubles-match');
  return data;
}

export type ConfirmDoublesResult = {
  status: string;
  yourTeam?: { delta: number; rating: number; rd: number };
};

// Confirm or decline a pending doubles match (only an opponent may act).
export async function confirmDoublesMatch(
  matchId: string,
  action: 'confirm' | 'decline',
): Promise<ConfirmDoublesResult> {
  if (DEMO) return demo.demoConfirmDoubles(matchId, action);
  const { data, error } = await supabase.functions.invoke<ConfirmDoublesResult>('confirm-doubles-match', {
    body: { matchId, action },
  });
  if (error) throw new Error(await functionErrorMessage(error));
  if (!data) throw new Error('No response from confirm-doubles-match');
  return data;
}
