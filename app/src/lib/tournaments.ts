import * as demo from '@/lib/demo';
import { DEMO } from '@/lib/env';
import type { RawGameInput } from '@/lib/matches';
import { functionErrorMessage, supabase } from '@/lib/supabase';

// registration: open for players to join until kickoff_at; active: drawn and
// being played; draft is unused.
export type TournamentStatus = 'draft' | 'registration' | 'active' | 'completed' | 'cancelled';

export type TournamentSummary = {
  id: string;
  name: string;
  status: TournamentStatus;
  size: number | null; // bracket size, once drawn
  bestOf: number;
  tier: number;
  createdAt: string;
  kickoffAt: string | null; // null for tournaments from before registration existed
  createdBy: string;
};

// A row of the Tournaments list.
export type TournamentListItem = TournamentSummary & {
  registeredCount: number | null; // players in it, for tournaments not over yet
  imIn: boolean; // the signed-in player is registered / in the draw
};

export type TournamentParticipant = {
  playerId: string;
  name: string;
  avatarUrl: string | null;
  seed: number | null; // given by the draw
  pot: number | null; // live during registration, frozen by the draw; none for older tournaments
  rating: number | null; // current during registration, at the draw after
  registeredAt: string | null; // breaks rating ties in the pots: earlier goes higher
};

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
  // Registration: by pot, best rating first. Drawn: by seed.
  participants: TournamentParticipant[];
  nodes: TournamentNode[];
  nameById: Record<string, string>;
  totalRounds: number; // 0 until the draw
};

// A tournament waiting for the draw although its kickoff time has come.
export function isPastKickoff(t: Pick<TournamentSummary, 'status' | 'kickoffAt'>, now = Date.now()): boolean {
  return t.status === 'registration' && !!t.kickoffAt && new Date(t.kickoffAt).getTime() <= now;
}

// The minimum field for a draw (MIN_PLAYERS in the kickoff function).
export const MIN_TOURNAMENT_PLAYERS = 4;

const SUMMARY_COLUMNS = 'id, name, status, size, best_of, tier, created_at, kickoff_at, created_by';

function mapSummary(row: any): TournamentSummary {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    size: row.size,
    bestOf: row.best_of,
    tier: row.tier,
    createdAt: row.created_at,
    kickoffAt: row.kickoff_at,
    createdBy: row.created_by,
  };
}

// Every tournament, newest first, with how many players are in the ones not
// over yet and whether the signed-in user (`myUserId`, the auth user) is.
export async function fetchTournaments(myUserId: string | null): Promise<TournamentListItem[]> {
  if (DEMO) return demo.demoTournaments();
  const { data, error } = await supabase
    .from('tournaments')
    .select(SUMMARY_COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data ?? [];

  const current = rows.filter((t: any) => t.status === 'registration' || t.status === 'active').map((t: any) => t.id);
  const counts = new Map<string, number>();
  const mine = new Set<string>();
  if (current.length > 0) {
    const { data: entries, error: pError } = await supabase
      .from('tournament_participants')
      .select('tournament_id, player:players(user_id)')
      .in('tournament_id', current);
    if (pError) throw pError;
    for (const e of (entries ?? []) as any[]) {
      counts.set(e.tournament_id, (counts.get(e.tournament_id) ?? 0) + 1);
      const player = Array.isArray(e.player) ? e.player[0] : e.player;
      if (myUserId && player?.user_id === myUserId) mine.add(e.tournament_id);
    }
  }
  return rows.map((t: any) => ({
    ...mapSummary(t),
    registeredCount: current.includes(t.id) ? counts.get(t.id) ?? 0 : null,
    imIn: mine.has(t.id),
  }));
}

export async function fetchTournamentDetail(id: string): Promise<TournamentDetail> {
  if (DEMO) return demo.demoTournamentDetail(id);
  const [tRes, pRes, liveRes, nRes] = await Promise.all([
    supabase.from('tournaments').select(SUMMARY_COLUMNS).eq('id', id).single(),
    supabase
      .from('tournament_participants')
      .select('seed, pot, rating_at_draw, registered_at, player:players(id, display_name, avatar_url)')
      .eq('tournament_id', id)
      .order('seed', { ascending: true }),
    // Only has rows while the tournament is open for registration.
    supabase
      .from('tournament_live_pots')
      .select('player_id, display_name, avatar_url, rating, pot, registered_at')
      .eq('tournament_id', id)
      .order('pot', { ascending: true })
      .order('rating', { ascending: false }),
    supabase
      .from('tournament_matches')
      .select('id, round, slot, player_a, player_b, winner_id, status')
      .eq('tournament_id', id)
      .order('round', { ascending: true })
      .order('slot', { ascending: true }),
  ]);
  if (tRes.error) throw tRes.error;
  if (pRes.error) throw pRes.error;
  if (liveRes.error) throw liveRes.error;
  if (nRes.error) throw nRes.error;

  const participants: TournamentParticipant[] =
    tRes.data.status === 'registration'
      ? (liveRes.data ?? []).map((row: any) => ({
          playerId: row.player_id,
          name: row.display_name,
          avatarUrl: row.avatar_url ?? null,
          seed: null,
          pot: row.pot,
          rating: row.rating,
          registeredAt: row.registered_at,
        }))
      : (pRes.data ?? []).map((row: any) => {
          const player = Array.isArray(row.player) ? row.player[0] : row.player;
          return {
            playerId: player.id,
            name: player.display_name,
            avatarUrl: player.avatar_url ?? null,
            seed: row.seed,
            pot: row.pot,
            rating: row.rating_at_draw,
            registeredAt: row.registered_at,
          };
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
  return {
    tournament,
    participants,
    nodes,
    nameById,
    totalRounds: tournament.size ? Math.log2(tournament.size) : 0,
  };
}

async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(fn, { body });
  if (error) throw new Error(await functionErrorMessage(error));
  if (!data) throw new Error(`No response from ${fn}`);
  return data;
}

// Admins only: opens a tournament for registration until `kickoffAt`.
export async function createTournament(input: {
  name: string;
  bestOf: number;
  kickoffAt: string;
}): Promise<{ tournamentId: string }> {
  if (DEMO) return demo.demoCreateTournament(input);
  return invoke<{ tournamentId: string }>('create-tournament', input);
}

export async function registerForTournament(tournamentId: string): Promise<void> {
  if (DEMO) return demo.demoRegister(tournamentId, true);
  await invoke('tournament-registration', { tournamentId, action: 'register' });
}

export async function withdrawFromTournament(tournamentId: string): Promise<void> {
  if (DEMO) return demo.demoRegister(tournamentId, false);
  await invoke('tournament-registration', { tournamentId, action: 'withdraw' });
}

// Admins only: make the draw now instead of at the kickoff time.
export async function startTournamentNow(tournamentId: string): Promise<void> {
  if (DEMO) return demo.demoStartNow(tournamentId);
  await invoke('manage-tournament', { tournamentId, action: 'start' });
}

// Admins only: move the kickoff.
export async function rescheduleTournament(tournamentId: string, kickoffAt: string): Promise<void> {
  if (DEMO) return demo.demoReschedule(tournamentId, kickoffAt);
  await invoke('manage-tournament', { tournamentId, action: 'reschedule', kickoffAt });
}

// Admins only: call off a tournament that hasn't started.
export async function cancelTournament(tournamentId: string): Promise<void> {
  if (DEMO) return demo.demoCancel(tournamentId);
  await invoke('manage-tournament', { tournamentId, action: 'cancel' });
}

// Asks the server to start any tournament whose kickoff time has come. The
// database does this on its own every minute; the app asks too when it shows
// one that's due, so whoever is watching sees the draw straight away.
export async function requestKickoff(): Promise<void> {
  if (DEMO) return demo.demoKickoffDue();
  await invoke('tournament-kickoff', {});
}

export async function recordTournamentMatch(input: {
  tournamentMatchId: string;
  games: RawGameInput[];
}): Promise<{ winnerId: string }> {
  if (DEMO) return demo.demoRecordTournamentMatch(input);
  return invoke<{ winnerId: string }>('submit-tournament-match', input);
}
