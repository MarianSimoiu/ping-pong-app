// In-memory demo backend used when Supabase isn't configured (see env.ts DEMO).
// Lets the app run in the browser with populated, mutable sample data — no
// network, no auth, no database. This file is only reached on the DEMO path;
// with real Supabase env set, none of it runs.

import type { DoublesPendingMatch, RankedTeam, Team } from '@/lib/doubles';
import type { LeaderboardEntry, HistoryPoint, MatchHistoryItem, SeasonEntry } from '@/lib/leaderboard';
import {
  addDays,
  CLUB_CLOSES,
  CLUB_OPENS,
  clubClock,
  clubDay,
  clubMoment,
  formatDay,
  isWeekend,
  nextWeekday,
  slotMinutes,
  type TableTime,
} from '@/lib/schedule';
import type {
  TournamentDetail,
  TournamentListItem,
  TournamentNode,
  TournamentParticipant,
  TournamentRound,
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
  rounds: TournamentRound[]; // the days each round is played, once drawn
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
      unanswered: demoUnanswered(p.id),
    }));
}

// Matches waiting on a player's answer: yours are the ones on Home (singles)
// and in Doubles; Cris is sitting on three, Fei on one.
const DEMO_UNANSWERED: Record<string, number> = { p4: 3, p7: 1 };
function demoUnanswered(id: string): number {
  return id === DEMO_ME ? pending.length + doublesToConfirm.length : (DEMO_UNANSWERED[id] ?? 0);
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
// The same catalog as the migrations (0015-0024); progress made up per player,
// plus the finished Autumn Open (Ana beat Ben in the final).

const DEMO_CATALOG: Achievement[] = [
  { code: 'regular', name: 'Regular', description: 'Play 25 matches', emoji: '🏓', target: 25, sort: 10 },
  { code: 'iron_paddle', name: 'Iron Paddle', description: 'Play 100 matches', emoji: '🛡️', target: 100, sort: 20 },
  { code: 'social_butterfly', name: 'Social Butterfly', description: 'Play 15 different opponents', emoji: '🦋', target: 15, sort: 30 },
  { code: 'giant_slayer', name: 'Giant Slayer', description: 'Beat someone rated 300+ points above you who has played 10+ matches', emoji: '🗡️', target: 1, sort: 40 },
  { code: 'farmer', name: 'Farmer', description: 'Play 10+ matches against the same player and win at least 80% of them', emoji: '🌾', target: 10, sort: 45 },
  { code: 'comeback_kid', name: 'Comeback Kid', description: 'Win a match after losing the first two games', emoji: '🔄', target: 1, sort: 50 },
  { code: 'bagel_baker', name: 'Bagel Baker', description: 'Win a game 11–0', emoji: '🥯', target: 1, sort: 60 },
  { code: 'deuce_master', name: 'Deuce Master', description: 'Win 10 games that went past 10–10', emoji: '🎯', target: 10, sort: 70 },
  { code: 'on_fire', name: 'On Fire', description: 'Win 5 matches in a row against 3+ different opponents', emoji: '🔥', target: 5, sort: 80 },
  { code: 'doubles_dynamo', name: 'Doubles Dynamo', description: 'Win 20 doubles matches', emoji: '🤝', target: 20, sort: 90 },
  { code: 'ride_or_die', name: 'Ride or Die', description: 'Win 10 doubles matches with the same partner', emoji: '🫶', target: 10, sort: 92 },
  { code: 'partner_hopper', name: 'Partner Hopper', description: 'Play doubles with 5 different partners', emoji: '🔀', target: 5, sort: 94 },
  { code: 'finalist', name: 'Finalist', description: 'Reach a tournament final', emoji: '🎖️', target: 1, sort: 100 },
  { code: 'dark_horse', name: 'Dark Horse', description: 'Win your way into a tournament semifinal from the bottom pot', emoji: '🐴', target: 1, sort: 104 },
  { code: 'seed_killer', name: 'Beast Killer', description: 'Knock the #1 seed out of a tournament', emoji: '🐉', target: 1, sort: 106 },
  { code: 'champion', name: 'Champion', description: 'Win a tournament', emoji: '🏆', target: 1, sort: 110 },
  { code: 'unkillable_demon_king', name: 'Unkillable Demon King', description: 'Win a tournament without losing a single game', emoji: '👹', target: 1, sort: 112 },
  { code: 'lunch_break_legend', name: 'Lunch Break Legend', description: 'Win 10 matches between 12:00 and 14:00', emoji: '🥪', target: 10, sort: 120 },
  { code: 'night_owl', name: 'Night Owl', description: 'Play a match after 20:00', emoji: '🦉', target: 1, sort: 130 },
  { code: 'touch_grass', name: 'Touch Grass', description: 'Play 10 matches in one day', emoji: '🌱', target: 10, sort: 140 },
  { code: 'coin_flip', name: 'Coin Flip', description: 'Have exactly as many wins as losses after 20+ matches', emoji: '🪙', target: 1, sort: 150 },
];

const daysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
const DEMO_PROGRESS: Record<string, Record<string, { progress: number; earnedAt: string | null }>> = {
  [DEMO_ME]: {
    regular: { progress: 14, earnedAt: null },
    social_butterfly: { progress: 7, earnedAt: null },
    giant_slayer: { progress: 1, earnedAt: daysAgo(5) },
    farmer: { progress: 6, earnedAt: null },
    bagel_baker: { progress: 1, earnedAt: daysAgo(12) },
    deuce_master: { progress: 6, earnedAt: null },
    on_fire: { progress: 3, earnedAt: null },
    doubles_dynamo: { progress: 3, earnedAt: null },
    lunch_break_legend: { progress: 7, earnedAt: null },
    touch_grass: { progress: 4, earnedAt: null },
    ride_or_die: { progress: 3, earnedAt: null },
    partner_hopper: { progress: 2, earnedAt: null },
  },
  p2: {
    regular: { progress: 25, earnedAt: daysAgo(60) },
    iron_paddle: { progress: 41, earnedAt: null },
    social_butterfly: { progress: 15, earnedAt: daysAgo(40) },
    deuce_master: { progress: 10, earnedAt: daysAgo(20) },
    on_fire: { progress: 5, earnedAt: daysAgo(15) },
    lunch_break_legend: { progress: 10, earnedAt: daysAgo(9) },
    night_owl: { progress: 1, earnedAt: daysAgo(33) },
    unkillable_demon_king: { progress: 1, earnedAt: daysAgo(25) }, // the Autumn Open without dropping a game
  },
  p3: {
    regular: { progress: 25, earnedAt: daysAgo(30) },
    social_butterfly: { progress: 11, earnedAt: null },
    seed_killer: { progress: 1, earnedAt: daysAgo(26) },
    farmer: { progress: 10, earnedAt: daysAgo(4) },
    touch_grass: { progress: 10, earnedAt: daysAgo(18) },
  },
};
const AUTUMN = { tournamentId: 'demo-t0', tournamentName: 'Autumn Open', at: daysAgo(25) };
// The Autumn Open's podium: Ana won the final against Ben; Dana and Cris lost the semifinals.
const DEMO_HONOURS: Record<string, 1 | 2 | 3> = { p2: 1, p3: 2, p4: 3, p5: 3 };
const DEMO_TITLES: Record<string, string> = { p2: 'unkillable_demon_king', p3: 'finalist' };
let myTitle: string | null = null;

function titleLabel(title: string): string {
  if (title.startsWith('champion:')) return `Champion · ${AUTUMN.tournamentName}`;
  return DEMO_CATALOG.find((a) => a.code === title)?.name ?? title;
}

export function demoTrophies(playerId: string): Trophies {
  const progress = { ...(DEMO_PROGRESS[playerId] ?? {}) };
  const p = byId(playerId);
  if (p && !progress.regular) progress.regular = { progress: Math.min(p.matches, 25), earnedAt: null };
  const place = DEMO_HONOURS[playerId];
  const honours = place ? [{ ...AUTUMN, place, won: place === 1 }] : [];
  const titles = [
    ...Object.entries(progress)
      .filter(([, v]) => v.earnedAt)
      .map(([code, v]) => ({ title: code, label: titleLabel(code), earnedAt: v.earnedAt! })),
    ...(place && place <= 2 ? [{ title: 'finalist', label: 'Finalist', earnedAt: AUTUMN.at }] : []),
    ...(place === 1 ? [{ title: 'champion:demo-t0', label: titleLabel('champion:demo-t0'), earnedAt: AUTUMN.at }] : []),
  ].sort((a, b) => (a.earnedAt < b.earnedAt ? -1 : 1));
  return { catalog: DEMO_CATALOG, progress, honours, titles };
}

export function demoSetTitle(title: string | null): void {
  if (title && !demoTrophies(DEMO_ME).titles.some((t) => t.title === title)) throw new Error("That title isn't earned yet");
  myTitle = title;
}

// --- tournaments -------------------------------------------------------------
// Mirrors the server: registration until kickoff for anyone (1500 with no
// matches yet), live pots (4 from 8 players, else 2), the draw at kickoff (each
// pot shuffled, Pot 1 seeded first, standard bracket), admin start/move/cancel.

const MIN_PLAYERS = 4;
// For the pots and the draw, as tournament_live_pots (0020).
const potRating = (p: P) => (p.matches === 0 ? 1500 : p.rating);

function listItem(t: TStore): TournamentListItem {
  const ids = t.summary.status === 'registration' ? t.registrations.map((r) => r.playerId) : t.participants.map((p) => p.playerId);
  const current = t.summary.status === 'registration' || t.summary.status === 'active';
  const final = t.summary.size ? t.nodes.find((n) => n.round === Math.log2(t.summary.size!)) : undefined;
  const champion = t.summary.status === 'completed' && final?.winnerId ? byId(final.winnerId)?.name ?? null : null;
  return { ...t.summary, registeredCount: current ? ids.length : null, imIn: ids.includes(DEMO_ME), champion };
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
    .sort((a, b) => potRating(b.p) - potRating(a.p) || a.at - b.at);
  const k = regs.length >= 8 ? 4 : regs.length >= 2 ? 2 : 1;
  return regs.map(({ p, at }, i) => ({
    playerId: p.id,
    name: p.name,
    avatarUrl: p.avatarUrl ?? null,
    seed: null,
    pot: ntile(i, regs.length, k),
    rating: potRating(p),
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
    nodes: t.nodes.map((n) => ({ ...n })),
    nameById,
    totalRounds: t.summary.size ? Math.log2(t.summary.size) : 0,
    rounds: t.rounds.map((r) => ({ ...r })),
    table: demoTable(),
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
      endedAt: null,
      createdBy: DEMO_ME,
    },
    registrations: [],
    participants: [],
    nodes: [],
    rounds: [],
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
  t.rounds = [];
  scheduleMatches(t);
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
  const { t, node } = nodeOf(input.tournamentMatchId);
  const aWins = input.games.filter((g) => g.score_a > g.score_b).length;
  const bWins = input.games.length - aWins;
  const winner = aWins >= bWins ? node.playerA! : node.playerB!;
  advance(t, node, winner);
  return { winnerId: winner };
}

// The match is over: the winner goes on (and the next match gets its time),
// or the final finishes the tournament.
function advance(t: TStore, node: TournamentNode, winner: string): void {
  Object.assign(node, { winnerId: winner, status: 'completed', proposedAt: null, proposedBy: null });
  const rounds = Math.log2(t.summary.size!);
  if (node.round < rounds) {
    const parent = t.nodes.find((n) => n.round === node.round + 1 && n.slot === Math.floor(node.slot / 2))!;
    if (node.slot % 2 === 0) parent.playerA = winner;
    else parent.playerB = winner;
    if (parent.playerA && parent.playerB) parent.status = 'ready';
    scheduleMatches(t);
  } else {
    t.summary.status = 'completed';
    t.summary.endedAt = new Date().toISOString();
  }
}

// --- when matches are played -------------------------------------------------
// Mirrors 0018: one round per weekday from the draw, each match the first free
// slot on the one table (11:00-18:00), players propose another time up to a
// day after the planned one and the other answers, admins move matches, set
// round dates and give walkovers. You're an admin here; nobody answers your
// proposals.

const nodeOf = (id: string) => {
  for (const t of tournaments) {
    const node = t.nodes.find((n) => n.id === id);
    if (node) return { t, node };
  }
  throw new Error('Match not found');
};

// Every match waiting on the table, in any tournament.
function demoTable(): TableTime[] {
  return tournaments.flatMap((t) =>
    t.nodes
      .filter((n) => n.status === 'ready' && n.scheduledAt)
      .map((n) => {
        const start = new Date(n.scheduledAt!).getTime();
        return { matchId: n.id, start, end: start + slotMinutes(t.summary.bestOf) * 60_000 };
      }),
  );
}

const clash = (matchId: string, at: number, len: number) =>
  demoTable().find((x) => x.matchId !== matchId && x.start < at + len && at < x.end);

function ensureRounds(t: TStore): void {
  if (!t.summary.size) return;
  let day = t.rounds.reduce((last, r) => (r.endsOn > last ? r.endsOn : last), '');
  if (!day) day = clubDay(Date.now());
  for (let r = 1; r <= Math.log2(t.summary.size); r++) {
    if (t.rounds.some((x) => x.round === r)) continue;
    day = nextWeekday(day);
    t.rounds.push({ round: r, startsOn: day, endsOn: day });
  }
  t.rounds.sort((a, b) => a.round - b.round);
}

function scheduleMatches(t: TStore): void {
  if (t.summary.status !== 'active' || !t.summary.size) return;
  ensureRounds(t);
  const len = slotMinutes(t.summary.bestOf) * 60_000;
  const now = Date.now();
  const today = clubDay(now);
  const waiting = t.nodes
    .filter((n) => n.status === 'ready' && !n.scheduledAt && n.playerA && n.playerB)
    .sort((a, b) => a.round - b.round || a.slot - b.slot);
  for (const n of waiting) {
    const r = t.rounds.find((x) => x.round === n.round)!;
    let day = r.startsOn > today ? r.startsOn : today;
    for (let tries = 0; tries < 400 && !n.scheduledAt; tries++, day = addDays(day, 1)) {
      if (day > r.endsOn && isWeekend(day)) continue;
      const closes = clubMoment(day, CLUB_CLOSES).getTime();
      for (let at = clubMoment(day, CLUB_OPENS).getTime(); at + len <= closes; at += 15 * 60_000) {
        if (at >= now + 15 * 60_000 && !clash(n.id, at, len)) {
          Object.assign(n, { scheduledAt: new Date(at).toISOString(), plannedOn: day, proposedAt: null, proposedBy: null });
          break;
        }
      }
    }
  }
}

// Throws the reason `at` can't be the match's time, as the database does.
function checkTime(t: TStore, node: TournamentNode, at: string, byAdmin: boolean): void {
  const ms = new Date(at).getTime();
  const len = slotMinutes(t.summary.bestOf) * 60_000;
  if (!(ms >= Date.now() + 5 * 60_000)) throw new Error('Pick a time in the future');
  if (!byAdmin) {
    const day = clubDay(ms);
    if (clubClock(ms) < CLUB_OPENS || clubClock(ms + len) > CLUB_CLOSES || clubDay(ms + len) !== day) {
      throw new Error(`Matches are played between ${CLUB_OPENS} and ${CLUB_CLOSES}`);
    }
    const latest = addDays(node.plannedOn ?? clubDay(Date.now()), 1);
    if (day > latest) throw new Error(`It can be moved to ${formatDay(latest)} at the latest`);
  }
  const other = clash(node.id, ms, len);
  if (other) {
    const o = nodeOf(other.matchId).node;
    const name = (id: string | null) => byId(id ?? '')?.name ?? '?';
    throw new Error(
      `The table is taken then: ${name(o.playerA)} v ${name(o.playerB)} (${clubClock(other.start)}-${clubClock(other.end)})`,
    );
  }
}

const isMine = (n: TournamentNode) => n.playerA === DEMO_ME || n.playerB === DEMO_ME;

export function demoProposeMatchTime(id: string, at: string): void {
  const { t, node } = nodeOf(id);
  if (!isMine(node)) throw new Error('Only the two players can propose another time');
  if (node.status !== 'ready') throw new Error("This match isn't waiting to be played");
  if (node.scheduledAt && new Date(node.scheduledAt).getTime() === new Date(at).getTime()) {
    throw new Error("That's already its time");
  }
  checkTime(t, node, at, false);
  Object.assign(node, { proposedAt: new Date(at).toISOString(), proposedBy: DEMO_ME });
}

export function demoAnswerMatchTime(id: string, action: 'accept' | 'decline' | 'withdraw'): void {
  const { t, node } = nodeOf(id);
  if (!isMine(node)) throw new Error('Only the two players can answer');
  if (node.status !== 'ready' || !node.proposedAt) throw new Error("There's no other time to answer");
  if (action === 'withdraw' && node.proposedBy !== DEMO_ME) {
    throw new Error('Only the player who proposed it can take it back');
  }
  if (action !== 'withdraw' && node.proposedBy === DEMO_ME) throw new Error('The other player has to answer it');
  if (action === 'accept') {
    checkTime(t, node, node.proposedAt, false);
    node.scheduledAt = node.proposedAt;
  }
  Object.assign(node, { proposedAt: null, proposedBy: null });
}

export function demoMoveMatch(id: string, at: string): void {
  const { t, node } = nodeOf(id);
  if (node.status !== 'ready' || !node.playerA || !node.playerB) {
    throw new Error('Only a match waiting to be played can be moved');
  }
  checkTime(t, node, at, true);
  Object.assign(node, { scheduledAt: new Date(at).toISOString(), plannedOn: clubDay(at), proposedAt: null, proposedBy: null });
}

export function demoSetRoundDates(input: {
  tournamentId: string;
  round: number;
  startsOn: string;
  endsOn: string;
}): { moved: number } {
  const t = find(input.tournamentId);
  if (t.summary.status !== 'active') throw new Error('Only a tournament in progress has round dates');
  if (input.endsOn < input.startsOn) throw new Error("The last day can't be before the first");
  const today = clubDay(Date.now());
  if (input.endsOn < today) throw new Error("The round can't end in the past");
  ensureRounds(t);
  const r = t.rounds.find((x) => x.round === input.round);
  if (!r) throw new Error(`No round ${input.round} in this tournament`);
  Object.assign(r, { startsOn: input.startsOn, endsOn: input.endsOn });
  const from = input.startsOn > today ? input.startsOn : today;
  let moved = 0;
  for (const n of t.nodes) {
    if (n.round !== input.round || n.status !== 'ready' || !n.scheduledAt) continue;
    const day = clubDay(n.scheduledAt);
    if (day >= from && day <= input.endsOn) continue;
    Object.assign(n, { scheduledAt: null, plannedOn: null, proposedAt: null, proposedBy: null });
    moved++;
  }
  scheduleMatches(t);
  return { moved };
}

export function demoGiveWalkover(id: string, winnerId: string): void {
  const { t, node } = nodeOf(id);
  if (node.status !== 'ready' || !node.playerA || !node.playerB) {
    throw new Error('Only a match waiting to be played can be given as a walkover');
  }
  if (winnerId !== node.playerA && winnerId !== node.playerB) throw new Error('The winner has to be one of the two players');
  node.walkover = true;
  advance(t, node, winnerId);
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
      nodes.push({
        id: `n-${stamp}-${r}-${s}`,
        round: r,
        slot: s,
        playerA: null,
        playerB: null,
        winnerId: null,
        status: 'pending',
        scheduledAt: null,
        plannedOn: null,
        proposedAt: null,
        proposedBy: null,
        walkover: false,
      });
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
      endedAt: new Date(Date.now() - 25 * 864e5).toISOString(),
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
    rounds: [], // from before rounds had dates
  };
}

// In progress, 8 players. Quarterfinals yesterday: you beat Cris, Ana beat
// Gabi, Dana went through on a walkover, and Ben v Fei wasn't played (overdue:
// the organizer decides). Semifinals today and tomorrow: yours against Ana is
// tomorrow at 11:00, and Ana asks to move it to 16:00.
function sampleTournament(): TStore {
  // In seed order (Pot 1 first): seeds 1 v 8, 4 v 5, 2 v 7, 3 v 6 meet first.
  const ids = ['p2', 'p3', 'p5', 'p4', DEMO_ME, 'p6', 'p7', 'p8'];
  const { nodes, size } = buildBracket(ids);
  const today = clubDay(Date.now());
  const [yesterday, tomorrow] = [addDays(today, -1), addDays(today, 1)];
  const at = (day: string, hhmm: string) => clubMoment(day, hhmm).toISOString();
  const node = (round: number, slot: number) => nodes.find((n) => n.round === round && n.slot === slot)!;
  const played = (round: number, slot: number, winner: string, extra: Partial<TournamentNode> = {}) => {
    const n = node(round, slot);
    Object.assign(n, { winnerId: winner, status: 'completed', ...extra });
    const parent = node(round + 1, Math.floor(slot / 2));
    if (slot % 2 === 0) parent.playerA = winner;
    else parent.playerB = winner;
    if (parent.playerA && parent.playerB) parent.status = 'ready';
  };
  played(1, 0, 'p2', { scheduledAt: at(yesterday, '11:00'), plannedOn: yesterday }); // Ana v Gabi
  played(1, 1, DEMO_ME, { scheduledAt: at(yesterday, '11:30'), plannedOn: yesterday }); // Cris v you
  Object.assign(node(1, 2), { scheduledAt: at(yesterday, '16:00'), plannedOn: yesterday }); // Ben v Fei: not played
  played(1, 3, 'p5', { walkover: true }); // Dana v Emil
  Object.assign(node(2, 0), {
    scheduledAt: at(tomorrow, '11:00'),
    plannedOn: tomorrow,
    proposedAt: at(tomorrow, '16:00'),
    proposedBy: 'p2',
  });
  const pots = [1, 1, 2, 2, 3, 3, 4, 4];
  return {
    summary: {
      id: 'demo-t1',
      name: 'Friday Night Cup',
      status: 'active',
      size,
      bestOf: 3,
      tier: 1,
      createdAt: new Date(Date.now() - 4 * 864e5).toISOString(),
      kickoffAt: new Date(Date.now() - 2 * 864e5).toISOString(),
      endedAt: null,
      createdBy: DEMO_ME,
    },
    registrations: [],
    participants: ids.map((playerId, i) => ({
      playerId,
      seed: i + 1,
      pot: pots[i],
      name: byId(playerId)?.name ?? '—',
      avatarUrl: null,
      rating: byId(playerId)?.rating ?? null,
      registeredAt: null,
    })),
    nodes,
    rounds: [
      { round: 1, startsOn: yesterday, endsOn: yesterday },
      { round: 2, startsOn: today, endsOn: tomorrow },
      { round: 3, startsOn: nextWeekday(tomorrow), endsOn: nextWeekday(tomorrow) },
    ],
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
      endedAt: null,
      createdBy: DEMO_ME,
    },
    registrations: others.map((playerId, i) => ({ playerId, at: Date.now() - (others.length - i) * 36e5 })),
    participants: [],
    nodes: [],
    rounds: [],
  };
}
