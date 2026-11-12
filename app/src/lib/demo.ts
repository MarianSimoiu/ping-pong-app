// In-memory demo backend used when Supabase isn't configured (see env.ts DEMO).
// Lets the app run in the browser with populated, mutable sample data — no
// network, no auth, no database. This file is only reached on the DEMO path;
// with real Supabase env set, none of it runs.

import type { DoublesPendingMatch, RankedTeam, Team } from '@/lib/doubles';
import type { LeaderboardEntry, HistoryPoint, MatchHistoryItem, SeasonEntry } from '@/lib/leaderboard';
import type {
  TournamentDetail,
  TournamentListItem,
  TournamentNode,
  TournamentParticipant,
  TournamentSummary,
} from '@/lib/tournaments';
import type { Achievement, Trophies } from '@/lib/achievements';
import { DEFAULT_TIER_LINES, type PlayerBadge, type Tier, type TierLine } from '@/lib/tiers';
import type { OpponentOption, PendingMatch, PlayerWithRating, SubmittedPendingMatch } from '@/lib/types';

const NOW = new Date().toISOString();
export const DEMO_ME = 'demo-me';

type P = {
  id: string;
  name: string;
  rating: number;
  rd: number;
  matches: number;
  avatarUrl?: string | null;
};

const players: P[] = [
  { id: DEMO_ME, name: 'You', rating: 1521, rd: 88, matches: 14, avatarUrl: null },
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
    avatar_url: p.avatarUrl ?? null,
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
  {
    matchId: 'pm1',
    submitterId: 'p2',
    submitterName: 'Ana',
    submitterAvatarUrl: null,
    iWon: false,
    myGames: 1,
    opponentGames: 2,
    games: [
      { myScore: 11, opponentScore: 7 },
      { myScore: 7, opponentScore: 11 },
      { myScore: 9, opponentScore: 11 },
    ],
    submittedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    matchId: 'pm2',
    submitterId: 'p6',
    submitterName: 'Emil',
    submitterAvatarUrl: null,
    iWon: true,
    myGames: 2,
    opponentGames: 0,
    games: [
      { myScore: 11, opponentScore: 5 },
      { myScore: 11, opponentScore: 9 },
    ],
    submittedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  },
];

// Matches "you" submitted, still awaiting the opponent's confirmation — the
// mirror image of `pending` above. Static seed data, same as `pending`:
// demoSubmitMatch() doesn't append here either (see its comment).
let submittedPending: SubmittedPendingMatch[] = [
  {
    matchId: 'spm1',
    opponentId: 'p4',
    opponentName: 'Cris',
    opponentAvatarUrl: null,
    iWon: true,
    myGames: 2,
    opponentGames: 1,
    games: [
      { myScore: 11, opponentScore: 8 },
      { myScore: 9, opponentScore: 11 },
      { myScore: 11, opponentScore: 7 },
    ],
    submittedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
  },
];

// Numbers each demo bracket (declared before the tournaments below are built).
let bracketCount = 0;

type TStore = {
  summary: TournamentSummary;
  // While open: who registered, and when (pots are worked out live).
  registrations: { playerId: string; at: number }[];
  // Once drawn: everyone with their seed and frozen pot.
  participants: TournamentParticipant[];
  nodes: TournamentNode[];
};
const tournaments: TStore[] = [finishedTournament(), sampleTournament(), openTournament()];

// --- profile / leaderboard ---------------------------------------------------

export const demoMyProfile = (): PlayerWithRating => toProfile(byId(DEMO_ME)!);
export function demoSetAvatar(uri: string): void {
  byId(DEMO_ME)!.avatarUrl = uri;
}
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
      avatarUrl: p.avatarUrl ?? null,
      rating: p.rating,
      rd: p.rd,
      matchesPlayed: p.matches,
      ...demoRecord(p.id),
    }));
}

export function demoSeasonStandings(): SeasonEntry[] {
  const pts: Record<string, number> = { p2: 196, p3: 160, [DEMO_ME]: 96, p4: 60, p6: 36 };
  return Object.entries(pts)
    .map(([playerId, points]) => ({
      playerId,
      points,
      displayName: byId(playerId)?.name ?? '—',
      avatarUrl: byId(playerId)?.avatarUrl ?? null,
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
  const opponents = players.filter((p) => p.id !== id);
  // A leading 3-win streak and a couple of big (|delta| >= 15) swings so the
  // streak banner and upset tags both have something to show in the demo.
  const sample: Array<[P, 'win' | 'loss', number]> = [
    [opponents[0], 'win', 9],
    [opponents[1], 'win', 22],
    [opponents[2], 'win', 7],
    [opponents[3], 'loss', -15],
    [opponents[4] ?? opponents[0], 'loss', -8],
  ];
  return sample.map(([opponent, result, delta], i) => ({
    id: `mh-${id}-${i}`,
    opponentId: opponent.id,
    opponentName: opponent.name,
    opponentAvatarUrl: opponent.avatarUrl ?? null,
    result,
    delta,
    ratingAfter: (byId(id)?.rating ?? 1500) - i * 6,
    at: new Date(Date.now() - i * 864e5).toISOString(),
    games:
      result === 'win'
        ? [{ myScore: 11, opponentScore: 7 }, { myScore: 11, opponentScore: 9 }]
        : [{ myScore: 7, opponentScore: 11 }, { myScore: 9, opponentScore: 11 }],
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

export const demoSubmittedPending = (): SubmittedPendingMatch[] => [...submittedPending];

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

// --- doubles -----------------------------------------------------------------

type DTeam = { id: string; a: string; b: string; rating: number; rd: number; matches: number; wins: number; losses: number };

const teams: DTeam[] = [
  { id: 't1', a: 'p2', b: 'p3', rating: 1648, rd: 92, matches: 12, wins: 9, losses: 3 },
  { id: 't2', a: 'p4', b: 'p5', rating: 1583, rd: 108, matches: 8, wins: 5, losses: 3 },
  { id: 't3', a: DEMO_ME, b: 'p6', rating: 1541, rd: 131, matches: 5, wins: 3, losses: 2 },
  { id: 't4', a: 'p7', b: 'p8', rating: 1466, rd: 152, matches: 4, wins: 1, losses: 3 },
  { id: 't5', a: DEMO_ME, b: 'p2', rating: 1580, rd: 290, matches: 1, wins: 1, losses: 0 },
];

const toTeam = (t: DTeam): Team => {
  const m = (id: string) => ({ id, name: byId(id)!.name, avatarUrl: byId(id)!.avatarUrl ?? null });
  return {
    id: t.id,
    members: [m(t.a), m(t.b)],
    rating: t.rating,
    rd: t.rd,
    matchesPlayed: t.matches,
    wins: t.wins,
    losses: t.losses,
  };
};

export const demoTeamLeaderboard = (): RankedTeam[] =>
  teams
    .filter((t) => t.matches >= 3)
    .sort((x, y) => y.rating - x.rating)
    .map((t, i) => ({ ...toTeam(t), rank: i + 1 }));

export const demoMyTeams = (): Team[] =>
  teams
    .filter((t) => t.a === DEMO_ME || t.b === DEMO_ME)
    .sort((x, y) => y.rating - x.rating)
    .map(toTeam);

let doublesToConfirm: DoublesPendingMatch[] = [
  {
    matchId: 'dpm1',
    partnerName: 'Emil',
    opponentNames: ['Cris', 'Dana'],
    submitterName: 'Cris',
    iWon: false,
    myGames: 1,
    opponentGames: 2,
    games: [
      { myScore: 11, opponentScore: 8 },
      { myScore: 9, opponentScore: 11 },
      { myScore: 10, opponentScore: 12 },
    ],
    submittedAt: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
  },
];

const doublesAwaitingOpponents: DoublesPendingMatch[] = [
  {
    matchId: 'dspm1',
    partnerName: 'Ana',
    opponentNames: ['Fei', 'Gabi'],
    submitterName: 'You',
    iWon: true,
    myGames: 2,
    opponentGames: 0,
    games: [
      { myScore: 11, opponentScore: 6 },
      { myScore: 11, opponentScore: 9 },
    ],
    submittedAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
  },
];

export const demoDoublesToConfirm = (): DoublesPendingMatch[] => [...doublesToConfirm];

export const demoDoublesAwaitingOpponents = (): DoublesPendingMatch[] => [...doublesAwaitingOpponents];

export function demoSubmitDoublesMatch(): { matchId: string; status: 'pending' } {
  // Like demoSubmitMatch: it waits on the opponents, so no list changes here.
  return { matchId: `dm-${Date.now()}`, status: 'pending' };
}

export function demoConfirmDoubles(
  matchId: string,
  action: 'confirm' | 'decline',
): { status: string; yourTeam?: { delta: number; rating: number; rd: number } } {
  const match = doublesToConfirm.find((m) => m.matchId === matchId);
  doublesToConfirm = doublesToConfirm.filter((m) => m.matchId !== matchId);
  if (action !== 'confirm' || !match) {
    return { status: action === 'confirm' ? 'confirmed' : 'rejected' };
  }
  const team = teams.find((t) => t.id === 't3')!; // You & Emil
  const delta = match.iWon ? 16 : -13;
  team.matches += 1;
  team.rating += delta;
  team.rd = Math.max(40, team.rd - 6);
  if (match.iWon) team.wins += 1;
  else team.losses += 1;
  return { status: 'confirmed', yourTeam: { delta, rating: team.rating, rd: team.rd } };
}

// --- tiers -------------------------------------------------------------------

// Tiers straight from the ratings with the default lines; Ana (best) is
// Legend and Fei hasn't played for a while, so every look shows up.
export function demoBadges(): { badges: Record<string, PlayerBadge>; lines: TierLine[] } {
  const lines = DEFAULT_TIER_LINES;
  const tierFor = (rating: number): Tier =>
    [...lines].reverse().find((l) => rating >= l.minRating)?.tier ?? 'bronze';
  const best = [...players].filter((p) => p.matches >= 3).sort((a, b) => b.rating - a.rating)[0];
  const leader = demoSeasonStandings()[0]?.playerId;
  const badges: Record<string, PlayerBadge> = {};
  for (const p of players) {
    const tier: Tier = p.matches >= 3 ? tierFor(p.rating) : 'unranked';
    const title = p.id === DEMO_ME ? myTitle : DEMO_TITLES[p.id] ?? null;
    badges[p.id] = {
      playerId: p.id,
      tier,
      bestTier: tier,
      legend: p.id === best?.id,
      inactive: p.id === 'p7',
      championCount: p.id === 'p2' ? 1 : 0,
      seasonLeader: p.id === leader,
      title,
      titleLabel: title ? titleLabel(title) : null,
    };
  }
  return { badges, lines };
}

// --- titles ------------------------------------------------------------------
// The same catalog as migration 0015; progress made up per player, plus the
// finished Autumn Open (Ana beat Ben in the final).

const DEMO_CATALOG: Achievement[] = [
  { code: 'regular', name: 'Regular', description: 'Play 25 matches', emoji: '🏓', target: 25, sort: 10 },
  { code: 'iron_paddle', name: 'Iron Paddle', description: 'Play 100 matches', emoji: '🛡️', target: 100, sort: 20 },
  { code: 'social_butterfly', name: 'Social Butterfly', description: 'Play 15 different opponents', emoji: '🦋', target: 15, sort: 30 },
  { code: 'giant_slayer', name: 'Giant Slayer', description: 'Beat someone rated 150+ points above you', emoji: '🗡️', target: 1, sort: 40 },
  { code: 'comeback_kid', name: 'Comeback Kid', description: 'Win a match after losing the first two games', emoji: '🔄', target: 1, sort: 50 },
  { code: 'bagel_baker', name: 'Bagel Baker', description: 'Win a game 11–0', emoji: '🥯', target: 1, sort: 60 },
  { code: 'deuce_master', name: 'Deuce Master', description: 'Win 10 games that went past 10–10', emoji: '🎯', target: 10, sort: 70 },
  { code: 'on_fire', name: 'On Fire', description: 'Win 5 matches in a row against 3+ different opponents', emoji: '🔥', target: 5, sort: 80 },
  { code: 'doubles_dynamo', name: 'Doubles Dynamo', description: 'Win 20 doubles matches', emoji: '🤝', target: 20, sort: 90 },
  { code: 'finalist', name: 'Finalist', description: 'Reach a tournament final', emoji: '🎖️', target: 1, sort: 100 },
  { code: 'champion', name: 'Champion', description: 'Win a tournament', emoji: '🏆', target: 1, sort: 110 },
];

const daysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
const DEMO_PROGRESS: Record<string, Record<string, { progress: number; earnedAt: string | null }>> = {
  [DEMO_ME]: {
    regular: { progress: 14, earnedAt: null },
    social_butterfly: { progress: 7, earnedAt: null },
    giant_slayer: { progress: 1, earnedAt: daysAgo(5) },
    bagel_baker: { progress: 1, earnedAt: daysAgo(12) },
    deuce_master: { progress: 6, earnedAt: null },
    on_fire: { progress: 3, earnedAt: null },
    doubles_dynamo: { progress: 3, earnedAt: null },
  },
  p2: {
    regular: { progress: 25, earnedAt: daysAgo(60) },
    iron_paddle: { progress: 41, earnedAt: null },
    social_butterfly: { progress: 15, earnedAt: daysAgo(40) },
    deuce_master: { progress: 10, earnedAt: daysAgo(20) },
    on_fire: { progress: 5, earnedAt: daysAgo(15) },
  },
  p3: { regular: { progress: 25, earnedAt: daysAgo(30) }, social_butterfly: { progress: 11, earnedAt: null } },
};
const AUTUMN = { tournamentId: 'demo-t0', tournamentName: 'Autumn Open', at: daysAgo(25) };
const DEMO_HONOURS: Record<string, { won: boolean }> = { p2: { won: true }, p3: { won: false } };
const DEMO_TITLES: Record<string, string> = { p2: 'champion:demo-t0', p3: 'finalist' };
let myTitle: string | null = null;

function titleLabel(title: string): string {
  if (title.startsWith('champion:')) return `Champion · ${AUTUMN.tournamentName}`;
  return DEMO_CATALOG.find((a) => a.code === title)?.name ?? title;
}

export function demoTrophies(playerId: string): Trophies {
  const progress = { ...(DEMO_PROGRESS[playerId] ?? {}) };
  const p = byId(playerId);
  if (p && !progress.regular) progress.regular = { progress: Math.min(p.matches, 25), earnedAt: null };
  const honour = DEMO_HONOURS[playerId];
  const honours = honour ? [{ ...AUTUMN, won: honour.won }] : [];
  const titles = [
    ...Object.entries(progress)
      .filter(([, v]) => v.earnedAt)
      .map(([code, v]) => ({ title: code, label: titleLabel(code), earnedAt: v.earnedAt! })),
    ...(honour ? [{ title: 'finalist', label: 'Finalist', earnedAt: AUTUMN.at }] : []),
    ...(honour?.won ? [{ title: 'champion:demo-t0', label: titleLabel('champion:demo-t0'), earnedAt: AUTUMN.at }] : []),
  ].sort((a, b) => (a.earnedAt < b.earnedAt ? -1 : 1));
  return { catalog: DEMO_CATALOG, progress, honours, titles };
}

export function demoSetTitle(title: string | null): void {
  if (title && !demoTrophies(DEMO_ME).titles.some((t) => t.title === title)) throw new Error("That title isn't earned yet");
  myTitle = title;
}

// --- tournaments -------------------------------------------------------------
// Mirrors the server: registration until kickoff for players on the
// leaderboard, live pots (4 from 8 players, else 2), the draw at kickoff (each
// pot shuffled, Pot 1 seeded first, standard bracket), admin start/move/cancel.

const MIN_MATCHES = 3;
const MIN_PLAYERS = 4;

function listItem(t: TStore): TournamentListItem {
  const ids = t.summary.status === 'registration' ? t.registrations.map((r) => r.playerId) : t.participants.map((p) => p.playerId);
  const current = t.summary.status === 'registration' || t.summary.status === 'active';
  return { ...t.summary, registeredCount: current ? ids.length : null, imIn: ids.includes(DEMO_ME) };
}

// Postgres's ntile: n rows into k buckets as equal as possible, bigger first.
function ntile(i: number, n: number, k: number): number {
  const base = Math.floor(n / k);
  const extra = n % k;
  const inBig = extra * (base + 1);
  return i < inBig ? Math.floor(i / (base + 1)) + 1 : extra + Math.floor((i - inBig) / base) + 1;
}

function livePots(t: TStore): TournamentParticipant[] {
  const regs = t.registrations
    .map((r) => ({ at: r.at, p: byId(r.playerId)! }))
    .sort((a, b) => b.p.rating - a.p.rating || a.at - b.at);
  const k = regs.length >= 8 ? 4 : regs.length >= 2 ? 2 : 1;
  return regs.map(({ p, at }, i) => ({
    playerId: p.id,
    name: p.name,
    avatarUrl: p.avatarUrl ?? null,
    seed: null,
    pot: ntile(i, regs.length, k),
    rating: p.rating,
    registeredAt: new Date(at).toISOString(),
  }));
}

const find = (id: string) => {
  const t = tournaments.find((x) => x.summary.id === id);
  if (!t) throw new Error('Tournament not found');
  return t;
};

function closedReason(t: TStore): string | null {
  if (t.summary.status === 'cancelled') return 'This tournament was cancelled';
  if (t.summary.status !== 'registration') return 'This tournament has already started';
  if (t.summary.kickoffAt && new Date(t.summary.kickoffAt).getTime() <= Date.now()) return 'Registration closed at kickoff';
  return null;
}

export const demoTournaments = (): TournamentListItem[] =>
  tournaments.map(listItem).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

export function demoTournamentDetail(id: string): TournamentDetail {
  const t = find(id);
  const participants =
    t.summary.status === 'registration'
      ? livePots(t)
      : [...t.participants].sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0));
  const nameById: Record<string, string> = {};
  for (const p of participants) nameById[p.playerId] = p.name;
  return {
    tournament: { ...t.summary },
    participants,
    nodes: t.nodes,
    nameById,
    totalRounds: t.summary.size ? Math.log2(t.summary.size) : 0,
  };
}

export function demoCreateTournament(input: { name: string; bestOf: number; kickoffAt: string }): { tournamentId: string } {
  const id = `t-${Date.now()}`;
  tournaments.push({
    summary: {
      id,
      name: input.name,
      status: 'registration',
      size: null,
      bestOf: input.bestOf,
      tier: 1,
      createdAt: new Date().toISOString(),
      kickoffAt: input.kickoffAt,
      createdBy: DEMO_ME,
    },
    registrations: [],
    participants: [],
    nodes: [],
  });
  return { tournamentId: id };
}

export function demoRegister(id: string, join: boolean): void {
  const t = find(id);
  const closed = closedReason(t);
  if (closed) throw new Error(closed);
  if (!join) {
    t.registrations = t.registrations.filter((r) => r.playerId !== DEMO_ME);
    return;
  }
  const played = byId(DEMO_ME)!.matches;
  if (played < MIN_MATCHES) {
    const more = MIN_MATCHES - played;
    throw new Error(`Only players on the leaderboard can register: play ${more} more match${more === 1 ? '' : 'es'}`);
  }
  if (!t.registrations.some((r) => r.playerId === DEMO_ME)) t.registrations.push({ playerId: DEMO_ME, at: Date.now() });
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function draw(t: TStore): void {
  const pots = livePots(t);
  if (pots.length < MIN_PLAYERS) throw new Error(`A tournament needs at least ${MIN_PLAYERS} players to start`);
  const seeded = [1, 2, 3, 4].flatMap((pot) => shuffled(pots.filter((p) => p.pot === pot)));
  const { nodes, size } = buildBracket(seeded.map((p) => p.playerId));
  t.participants = seeded.map((p, i) => ({ ...p, seed: i + 1 }));
  t.nodes = nodes;
  t.summary.size = size;
  t.summary.status = 'active';
}

export function demoStartNow(id: string): void {
  const t = find(id);
  if (t.summary.status !== 'registration') throw new Error('This tournament has already started');
  draw(t);
  t.summary.kickoffAt = new Date().toISOString();
}

export function demoKickoffDue(): void {
  for (const t of tournaments) {
    const due = t.summary.status === 'registration' && !!t.summary.kickoffAt && new Date(t.summary.kickoffAt).getTime() <= Date.now();
    if (due && t.registrations.length >= MIN_PLAYERS) draw(t);
  }
}

export function demoReschedule(id: string, kickoffAt: string): void {
  const t = find(id);
  if (t.summary.status !== 'registration') throw new Error("Only a tournament that hasn't started can be rescheduled");
  if (new Date(kickoffAt).getTime() <= Date.now()) throw new Error('Pick a kickoff time in the future');
  t.summary.kickoffAt = kickoffAt;
}

export function demoCancel(id: string): void {
  const t = find(id);
  if (t.summary.status !== 'registration') throw new Error("Only a tournament that hasn't started can be cancelled");
  t.summary.status = 'cancelled';
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
  const rounds = Math.log2(t.summary.size!);
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

// Standard bracket seeding (same as the server's bracket.ts): for 8,
// [1, 8, 4, 5, 2, 7, 3, 6], so seeds 1 and 2 can only meet in the final.
function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    order = order.flatMap((s) => [s, sum - s]);
  }
  return order;
}

// A single-elimination bracket from players in seed order; byes go to the top
// seeds and move them straight on.
function buildBracket(ids: string[]): { nodes: TournamentNode[]; size: number } {
  let size = 2;
  while (size < ids.length) size *= 2;
  const rounds = Math.log2(size);
  const stamp = `${Date.now()}-${++bracketCount}`; // unique even for brackets built in the same millisecond
  const nodes: TournamentNode[] = [];
  for (let r = 1; r <= rounds; r++) {
    for (let s = 0; s < size / 2 ** r; s++) {
      nodes.push({ id: `n-${stamp}-${r}-${s}`, round: r, slot: s, playerA: null, playerB: null, winnerId: null, status: 'pending' });
    }
  }
  const at = (r: number, s: number) => nodes.find((n) => n.round === r && n.slot === s)!;
  const order = seedOrder(size);
  const player = (seed: number) => (seed <= ids.length ? ids[seed - 1] : null);
  for (let s = 0; s < size / 2; s++) {
    const node = at(1, s);
    node.playerA = player(order[s * 2]);
    node.playerB = player(order[s * 2 + 1]);
    if (node.playerA && node.playerB) node.status = 'ready';
  }
  for (let s = 0; s < size / 2; s++) {
    const node = at(1, s);
    if (!!node.playerA !== !!node.playerB) {
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

// A finished tournament: Ana beat Dana and Ben beat Cris, then Ana won the
// final against Ben (her champion title and laurel come from it).
function finishedTournament(): TStore {
  const ids = ['p2', 'p3', 'p4', 'p5'];
  const { nodes, size } = buildBracket(ids);
  for (const n of nodes.filter((x) => x.round === 1)) {
    n.winnerId = n.playerA;
    n.status = 'completed';
  }
  const final = nodes.find((n) => n.round === 2)!;
  final.playerA = 'p2';
  final.playerB = 'p3';
  final.winnerId = 'p2';
  final.status = 'completed';
  return {
    summary: {
      id: 'demo-t0',
      name: 'Autumn Open',
      status: 'completed',
      size,
      bestOf: 3,
      tier: 1,
      createdAt: new Date(Date.now() - 30 * 864e5).toISOString(),
      kickoffAt: null,
      createdBy: DEMO_ME,
    },
    registrations: [],
    participants: ids.map((playerId, i) => ({
      playerId,
      seed: i + 1,
      pot: null,
      name: byId(playerId)?.name ?? '—',
      avatarUrl: null,
      rating: byId(playerId)?.rating ?? null,
      registeredAt: null,
    })),
    nodes,
  };
}

// A tournament from before registration existed: hand-picked, no pots, one
// semifinal played (Ana beat Dana); yours against Ben is up next.
function sampleTournament(): TStore {
  const ids = ['p2', 'p3', DEMO_ME, 'p5'];
  const { nodes, size } = buildBracket(ids);
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
      kickoffAt: null,
      createdBy: DEMO_ME,
    },
    registrations: [],
    participants: ids.map((playerId, i) => ({
      playerId,
      seed: i + 1,
      pot: null,
      name: byId(playerId)?.name ?? '—',
      avatarUrl: null,
      rating: byId(playerId)?.rating ?? null,
      registeredAt: null,
    })),
    nodes,
  };
}

// Open for registration, kickoff in two days at 18:00: seven players in, so
// two pots, until an eighth (you) makes it four.
function openTournament(): TStore {
  const kickoff = new Date(Date.now() + 2 * 864e5);
  kickoff.setHours(18, 0, 0, 0);
  const others = ['p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
  return {
    summary: {
      id: 'demo-t2',
      name: 'Winter Cup',
      status: 'registration',
      size: null,
      bestOf: 3,
      tier: 1,
      createdAt: new Date(Date.now() - 864e5).toISOString(),
      kickoffAt: kickoff.toISOString(),
      createdBy: DEMO_ME,
    },
    registrations: others.map((playerId, i) => ({ playerId, at: Date.now() - (others.length - i) * 36e5 })),
    participants: [],
    nodes: [],
  };
}
