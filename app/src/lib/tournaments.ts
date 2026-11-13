import * as demo from '@/lib/demo';
import { DEMO } from '@/lib/env';
import type { RawGameInput } from '@/lib/matches';
import { slotMinutes, type TableTime } from '@/lib/schedule';
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
  endedAt: string | null; // when the final was played
  createdBy: string;
};

// A row of the Tournaments list.
export type TournamentListItem = TournamentSummary & {
  registeredCount: number | null; // players in it, for tournaments not over yet
  imIn: boolean; // the signed-in player is registered / in the draw
  champion: string | null; // the winner's name, once it's over
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
  // When it's to be played, once both players are known (lib/schedule.ts).
  scheduledAt: string | null;
  plannedOn: string | null; // the day it was set for: players can move it a day past it at most
  proposedAt: string | null; // another time one player asked for, until the other answers
  proposedBy: string | null;
  walkover: boolean; // won without playing (the organizer's call)
};

// The days a round is played (club days, "2026-11-16").
export type TournamentRound = { round: number; startsOn: string; endsOn: string };

export type TournamentDetail = {
  tournament: TournamentSummary;
  // Registration: by pot, best rating first. Drawn: by seed.
  participants: TournamentParticipant[];
  nodes: TournamentNode[];
  nameById: Record<string, string>;
  totalRounds: number; // 0 until the draw
  rounds: TournamentRound[]; // once drawn
  // Every match waiting on the table, in any tournament: the times taken.
  table: TableTime[];
};

// A tournament waiting for the draw although its kickoff time has come.
export function isPastKickoff(t: Pick<TournamentSummary, 'status' | 'kickoffAt'>, now = Date.now()): boolean {
  return t.status === 'registration' && !!t.kickoffAt && new Date(t.kickoffAt).getTime() <= now;
}

// The minimum field for a draw (MIN_PLAYERS in the kickoff function).
export const MIN_TOURNAMENT_PLAYERS = 4;

const SUMMARY_COLUMNS = 'id, name, status, size, best_of, tier, created_at, kickoff_at, end_date, created_by';

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
    endedAt: row.end_date ?? null,
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
  // The champions of the ones that are over (tournament_podium, 0021). Only a
  // nicety for the list: without it, a finished tournament shows no winner.
  const champions = new Map<string, string>();
  const over = rows.filter((t: any) => t.status === 'completed').map((t: any) => t.id);
  if (over.length > 0) {
    const { data: winners } = await supabase
      .from('tournament_podium')
      .select('tournament_id, display_name')
      .eq('place', 1)
      .in('tournament_id', over);
    for (const w of (winners ?? []) as any[]) champions.set(w.tournament_id, w.display_name);
  }
  return rows.map((t: any) => ({
    ...mapSummary(t),
    registeredCount: current.includes(t.id) ? counts.get(t.id) ?? 0 : null,
    imIn: mine.has(t.id),
    champion: champions.get(t.id) ?? null,
  }));
}

const mapNode = (n: any): TournamentNode => ({
  id: n.id,
  round: n.round,
  slot: n.slot,
  playerA: n.player_a,
  playerB: n.player_b,
  winnerId: n.winner_id,
  status: n.status,
  scheduledAt: n.scheduled_at ?? null,
  plannedOn: n.planned_on ?? null,
  proposedAt: n.proposed_at ?? null,
  proposedBy: n.proposed_by ?? null,
  walkover: !!n.walkover,
});

export async function fetchTournamentDetail(id: string): Promise<TournamentDetail> {
  if (DEMO) return demo.demoTournamentDetail(id);
  const [tRes, pRes, liveRes, nRes, rRes, tableRes] = await Promise.all([
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
      .select(
        'id, round, slot, player_a, player_b, winner_id, status, scheduled_at, planned_on, proposed_at, proposed_by, walkover',
      )
      .eq('tournament_id', id)
      .order('round', { ascending: true })
      .order('slot', { ascending: true }),
    supabase
      .from('tournament_rounds')
      .select('round, starts_on, ends_on')
      .eq('tournament_id', id)
      .order('round', { ascending: true }),
    // The one table: what's booked from today on, in any tournament.
    supabase
      .from('tournament_matches')
      .select('id, scheduled_at, tournament:tournaments(best_of)')
      .eq('status', 'ready')
      .gte('scheduled_at', new Date(Date.now() - 864e5).toISOString()),
  ]);
  if (tRes.error) throw tRes.error;
  if (pRes.error) throw pRes.error;
  if (liveRes.error) throw liveRes.error;
  if (nRes.error) throw nRes.error;
  if (rRes.error) throw rRes.error;
  if (tableRes.error) throw tableRes.error;

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

  const nodes: TournamentNode[] = (nRes.data ?? []).map(mapNode);
  const rounds: TournamentRound[] = (rRes.data ?? []).map((r: any) => ({
    round: r.round,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
  }));
  const table: TableTime[] = (tableRes.data ?? []).map((m: any) => {
    const t = Array.isArray(m.tournament) ? m.tournament[0] : m.tournament;
    const start = new Date(m.scheduled_at).getTime();
    return { matchId: m.id, start, end: start + slotMinutes(t?.best_of ?? 3) * 60_000 };
  });

  const tournament = mapSummary(tRes.data);
  return {
    tournament,
    participants,
    nodes,
    nameById,
    totalRounds: tournament.size ? Math.log2(tournament.size) : 0,
    rounds,
    table,
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

// --- When matches are played (the match-schedule function) ------------------

// A player asks to move their match to `at`; it moves once the other accepts.
export async function proposeMatchTime(tournamentMatchId: string, at: string): Promise<void> {
  if (DEMO) return demo.demoProposeMatchTime(tournamentMatchId, at);
  await invoke('match-schedule', { action: 'propose', tournamentMatchId, at });
}

// The other player accepts or declines the time asked for; the one who asked
// can take it back (withdraw).
export async function answerMatchTime(
  tournamentMatchId: string,
  action: 'accept' | 'decline' | 'withdraw',
): Promise<void> {
  if (DEMO) return demo.demoAnswerMatchTime(tournamentMatchId, action);
  await invoke('match-schedule', { action, tournamentMatchId });
}

// Admins only: move a match to any future time.
export async function moveTournamentMatch(tournamentMatchId: string, at: string): Promise<void> {
  if (DEMO) return demo.demoMoveMatch(tournamentMatchId, at);
  await invoke('match-schedule', { action: 'move', tournamentMatchId, at });
}

// Admins only: the days a round is played. Its matches outside them get new
// times in them; returns how many.
export async function setRoundDates(input: {
  tournamentId: string;
  round: number;
  startsOn: string;
  endsOn: string;
}): Promise<{ moved: number }> {
  if (DEMO) return demo.demoSetRoundDates(input);
  return invoke<{ moved: number }>('match-schedule', { action: 'dates', ...input });
}

// Admins only: `winnerId` goes through without the match being played (no
// rating change).
export async function giveWalkover(tournamentMatchId: string, winnerId: string): Promise<void> {
  if (DEMO) return demo.demoGiveWalkover(tournamentMatchId, winnerId);
  await invoke('match-schedule', { action: 'walkover', tournamentMatchId, winnerId });
}
