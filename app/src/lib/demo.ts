// In-memory demo backend used when Supabase isn't configured (see env.ts DEMO).
// Lets the app run in the browser with populated, mutable sample data — no
// network, no auth, no database. This file is only reached on the DEMO path;
// with real Supabase env set, none of it runs.

import type { LeaderboardEntry, HistoryPoint, MatchHistoryItem, SeasonEntry } from '@/lib/leaderboard';
import type {
  PlayerWithRatingRow,
  TournamentDetail,
  TournamentNode,
  TournamentParticipant,
  TournamentSummary,
} from '@/lib/tournaments';
import type { OpponentOption, PendingMatch, PlayerWithRating } from '@/lib/types';

const NOW = new Date().toISOString();
export const DEMO_ME = 'demo-me';

type P = { id: string; name: string; rating: number; rd: number; matches: number };

const players: P[] = [
  { id: DEMO_ME, name: 'You', rating: 1521, rd: 88, matches: 14 },
  { id: 'p2', name: 'Ana', rating: 1712, rd: 58, matches: 41 },
  { id: 'p3', name: 'Ben', rating: 1644, rd: 66, matches: 29 },
  { id: 'p4', name: 'Cris', rating: 1598, rd: 72, matches: 33 },
  { id: 'p5', name: 'Dana', rating: 1556, rd: 80, matches: 18 },
  { id: 'p6', name: 'Emil', rating: 1487, rd: 74, matches: 22 },
  { id: 'p7', name: 'Fei', rating: 1402, rd: 96, matches: 12 },
  { id: 'p8', name: 'Gabi', rating: 1368, rd: 120, matches: 7 },
];
const byId = (id: string) => players.find((p) => p.id === id);

function toProfile(p: P): PlayerWithRating {
  return {
    id: p.id,
    user_id: `u-${p.id}`,
    display_name: p.name,
    avatar_url: null,
    created_at: NOW,
    rating: {
      player_id: p.id,
      rating: p.rating,
      rd: p.rd,
      volatility: 0.06,
      matches_played: p.matches,
      last_played_at: NOW,
      updated_at: NOW,
    },
  };
}

// --- mutable state -----------------------------------------------------------

let pending: PendingMatch[] = [
  { matchId: 'pm1', submitterName: 'Ana', iWon: false, myGames: 1, opponentGames: 2 },
  { matchId: 'pm2', submitterName: 'Emil', iWon: true, myGames: 2, opponentGames: 0 },
];

type TStore = {
  summary: TournamentSummary;
  participants: TournamentParticipant[];
  nodes: TournamentNode[];
};
const tournaments: TStore[] = [sampleTournament()];

// --- profile / leaderboard ---------------------------------------------------

export const demoMyProfile = (): PlayerWithRating => toProfile(byId(DEMO_ME)!);
export const demoPlayerById = (id: string): PlayerWithRating | null => {
  const p = byId(id);
  return p ? toProfile(p) : null;
};

export function demoLeaderboard(): LeaderboardEntry[] {
  return [...players]
    .filter((p) => p.matches >= 5)
    .sort((a, b) => b.rating - a.rating)
    .map((p, i) => ({
      rank: i + 1,
      playerId: p.id,
      displayName: p.name,
      rating: p.rating,
      rd: p.rd,
      matchesPlayed: p.matches,
    }));
}

export function demoSeasonStandings(): SeasonEntry[] {
  const pts: Record<string, number> = { p2: 196, p3: 160, [DEMO_ME]: 96, p4: 60, p6: 36 };
  return Object.entries(pts)
    .map(([playerId, points]) => ({
      playerId,
      points,
      displayName: byId(playerId)?.name ?? '—',
      events: points > 120 ? 3 : points > 60 ? 2 : 1,
      rank: 0,
    }))
    .sort((a, b) => b.points - a.points)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

export function demoRatingHistory(id: string): HistoryPoint[] {
  const base = byId(id)?.rating ?? 1500;
  const deltas = [-70, -40, -55, -10, 15, -5, 30, 45, 20];
  let r = base - 60;
  return deltas.map((d, i) => {
    r += d;
    return { at: new Date(Date.now() - (deltas.length - i) * 864e5).toISOString(), rating: r };
  });
}

export function demoMatchHistory(id: string): MatchHistoryItem[] {
  const names = players.filter((p) => p.id !== id).map((p) => p.name);
  // A leading 3-win streak and a couple of big (|delta| >= 15) swings so the
  // streak banner and upset tags both have something to show in the demo.
  const sample: Array<[string, 'win' | 'loss', number]> = [
    [names[0], 'win', 9],
    [names[1], 'win', 22],
    [names[2], 'win', 7],
    [names[3], 'loss', -15],
    [names[4] ?? 'Ana', 'loss', -8],
  ];
  return sample.map(([opponentName, result, delta], i) => ({
    id: `mh-${id}-${i}`,
    opponentName,
    result,
    delta,
    ratingAfter: (byId(id)?.rating ?? 1500) - i * 6,
    at: new Date(Date.now() - i * 864e5).toISOString(),
  }));
}

export const demoRecord = (id: string) => {
  const m = byId(id)?.matches ?? 0;
  return { wins: Math.ceil(m * 0.6), losses: Math.floor(m * 0.4) };
};
export const demoPlayerSeasonPoints = (id: string): number =>
  demoSeasonStandings().find((e) => e.playerId === id)?.points ?? 0;

// --- matches -----------------------------------------------------------------

export const demoOpponents = (): OpponentOption[] =>
  players.filter((p) => p.id !== DEMO_ME).map((p) => ({ id: p.id, display_name: p.name }));

export function demoSubmitMatch(): { matchId: string; status: 'pending' } {
  // Submitted by "you" → awaits the opponent, so it doesn't join your own list.
  return { matchId: `m-${Date.now()}`, status: 'pending' };
}

export const demoPending = (): PendingMatch[] => [...pending];

export function demoConfirm(
  matchId: string,
  action: 'confirm' | 'decline',
): { status: string; you?: { delta: number; rating: number; rd: number } } {
  const match = pending.find((m) => m.matchId === matchId);
  pending = pending.filter((m) => m.matchId !== matchId);
  if (action !== 'confirm' || !match) {
    return { status: action === 'confirm' ? 'confirmed' : 'rejected' };
  }
  const me = byId(DEMO_ME)!;
  const delta = match.iWon ? 14 : -12;
  me.matches += 1;
  me.rating += delta;
  me.rd = Math.max(40, me.rd - 3);
  return { status: 'confirmed', you: { delta, rating: me.rating, rd: me.rd } };
}

// --- tournaments -------------------------------------------------------------

export const demoTournaments = (): TournamentSummary[] =>
  tournaments.map((t) => t.summary).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

export const demoSeedablePlayers = (): PlayerWithRatingRow[] =>
  [...players]
    .sort((a, b) => b.rating - a.rating)
    .map((p) => ({ id: p.id, name: p.name, rating: p.rating, matchesPlayed: p.matches }));

export function demoTournamentDetail(id: string): TournamentDetail {
  const t = tournaments.find((x) => x.summary.id === id) ?? tournaments[0];
  const nameById: Record<string, string> = {};
  for (const p of t.participants) nameById[p.playerId] = p.name;
  return {
    tournament: t.summary,
    participants: t.participants,
    nodes: t.nodes,
    nameById,
    totalRounds: Math.log2(t.summary.size),
  };
}

export function demoCreateTournament(input: {
  name: string;
  bestOf: number;
  participantIds: string[];
}): { tournamentId: string } {
  const id = `t-${Date.now()}`;
  const { nodes, size } = buildBracket(input.participantIds);
  tournaments.push({
    summary: {
      id,
      name: input.name,
      status: 'active',
      size,
      bestOf: input.bestOf,
      tier: 1,
      createdAt: new Date().toISOString(),
    },
    participants: input.participantIds.map((playerId, i) => ({
      playerId,
      seed: i + 1,
      name: byId(playerId)?.name ?? '—',
    })),
    nodes,
  });
  return { tournamentId: id };
}

export function demoRecordTournamentMatch(input: {
  tournamentMatchId: string;
  games: Array<{ score_a: number; score_b: number }>;
}): { winnerId: string } {
  const t = tournaments.find((x) => x.nodes.some((n) => n.id === input.tournamentMatchId))!;
  const node = t.nodes.find((n) => n.id === input.tournamentMatchId)!;
  const aWins = input.games.filter((g) => g.score_a > g.score_b).length;
  const bWins = input.games.length - aWins;
  const winner = aWins >= bWins ? node.playerA! : node.playerB!;
  node.winnerId = winner;
  node.status = 'completed';
  const rounds = Math.log2(t.summary.size);
  if (node.round < rounds) {
    const parent = t.nodes.find((n) => n.round === node.round + 1 && n.slot === Math.floor(node.slot / 2))!;
    if (node.slot % 2 === 0) parent.playerA = winner;
    else parent.playerB = winner;
    if (parent.playerA && parent.playerB) parent.status = 'ready';
  } else {
    t.summary.status = 'completed';
  }
  return { winnerId: winner };
}

// --- helpers -----------------------------------------------------------------

function buildBracket(ids: string[]): { nodes: TournamentNode[]; size: number } {
  let size = 1;
  while (size < ids.length) size *= 2;
  const rounds = Math.log2(size);
  const nodes: TournamentNode[] = [];
  for (let r = 1; r <= rounds; r++) {
    for (let s = 0; s < size / 2 ** r; s++) {
      nodes.push({ id: `n-${Date.now()}-${r}-${s}`, round: r, slot: s, playerA: null, playerB: null, winnerId: null, status: 'pending' });
    }
  }
  const at = (r: number, s: number) => nodes.find((n) => n.round === r && n.slot === s)!;
  const seeded: (string | null)[] = [...ids];
  while (seeded.length < size) seeded.push(null);
  for (let s = 0; s < size / 2; s++) {
    const a = seeded[s * 2];
    const b = seeded[s * 2 + 1];
    const node = at(1, s);
    node.playerA = a;
    node.playerB = b;
    if (a && b) node.status = 'ready';
  }
  for (let s = 0; s < size / 2; s++) {
    const node = at(1, s);
    const only = !!node.playerA !== !!node.playerB;
    if (only) {
      const w = (node.playerA ?? node.playerB)!;
      node.winnerId = w;
      node.status = 'completed';
      if (rounds >= 2) {
        const parent = at(2, Math.floor(s / 2));
        if (s % 2 === 0) parent.playerA = w;
        else parent.playerB = w;
        if (parent.playerA && parent.playerB) parent.status = 'ready';
      }
    }
  }
  return { nodes, size };
}

function sampleTournament(): TStore {
  const ids = ['p2', 'p3', DEMO_ME, 'p5'];
  const { nodes, size } = buildBracket(ids);
  // Play the first semifinal so there's a completed match to look at.
  const sf0 = nodes.find((n) => n.round === 1 && n.slot === 0)!;
  sf0.winnerId = sf0.playerA;
  sf0.status = 'completed';
  const final = nodes.find((n) => n.round === 2 && n.slot === 0)!;
  final.playerA = sf0.playerA;
  return {
    summary: {
      id: 'demo-t1',
      name: 'Friday Night Cup',
      status: 'active',
      size,
      bestOf: 3,
      tier: 1,
      createdAt: new Date(Date.now() - 2 * 864e5).toISOString(),
    },
    participants: ids.map((playerId, i) => ({ playerId, seed: i + 1, name: byId(playerId)?.name ?? '—' })),
    nodes,
  };
}
