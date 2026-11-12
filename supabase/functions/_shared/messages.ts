import { TIER_EMOJI, TIER_NAMES, type Tier } from './tiers.ts';

// The text of every push notification, in one place. The match Edge Functions
// pick one of these and send it through notify.ts. Scores and rating changes
// are always from the recipient's side.

export type PushMessage = {
  title: string;
  body: string;
  url: string; // the app page a tap opens
  tag?: string; // a newer notification with the same tag replaces the older one
};

type Result = { youWon: boolean; yourGames: number; theirGames: number };
type RatingChange = { delta: number; rating: number };

const score = (r: Result) => `${r.yourGames}–${r.theirGames}`;
const wonOrLost = (r: Result) => (r.youWon ? 'won' : 'lost');
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

// Games won by each side, from the stored per-game scores (score_a is side a's).
export function gamesWon(games: { score_a: number; score_b: number }[]) {
  return {
    a: games.filter((g) => g.score_a > g.score_b).length,
    b: games.filter((g) => g.score_b > g.score_a).length,
  };
}

// To the opponent of a singles match that was just recorded.
export function singlesToConfirm(o: Result & { matchId: string; submitter: string }): PushMessage {
  return {
    title: `${o.submitter} recorded a match`,
    body: `You ${wonOrLost(o)} ${score(o)}. Tap to confirm or decline.`,
    url: '/',
    tag: `match-${o.matchId}`,
  };
}

// To the player who recorded a singles match, once the opponent confirms it.
export function singlesConfirmed(o: Result & RatingChange & { matchId: string; opponent: string }): PushMessage {
  return {
    title: `${o.opponent} confirmed your match`,
    body: `You ${wonOrLost(o)} ${score(o)} · rating ${signed(o.delta)}, now ${o.rating}.`,
    url: '/',
    tag: `match-${o.matchId}`,
  };
}

// To the player who recorded a singles match, if the opponent declines it.
export function singlesDeclined(o: Result & { matchId: string; opponent: string }): PushMessage {
  return {
    title: `${o.opponent} declined your match`,
    body: `Your ${score(o)} ${o.youWon ? 'win' : 'loss'} won't count.`,
    url: '/',
    tag: `match-${o.matchId}`,
  };
}

// To each opponent of a doubles match that was just recorded.
export function doublesToConfirm(
  o: Result & { matchId: string; submitter: string; submitterPartner: string; yourPartner: string },
): PushMessage {
  return {
    title: `${o.submitter} recorded a doubles match`,
    body: `You & ${o.yourPartner} ${wonOrLost(o)} ${score(o)} vs ${o.submitter} & ${o.submitterPartner}. Tap to confirm or decline.`,
    url: '/',
    tag: `doubles-${o.matchId}`,
  };
}

// To the other three players once one opponent confirms a doubles match:
// the team that recorded it, and the confirmer's partner.
export function doublesConfirmed(
  o: Result &
    RatingChange & {
      matchId: string;
      confirmer: string;
      yourPartner: string;
      opponents: [string, string];
      recordedByYourTeam: boolean;
    },
): PushMessage {
  return {
    title: o.recordedByYourTeam ? `${o.confirmer} confirmed your doubles match` : `${o.confirmer} confirmed a doubles match`,
    body: `You & ${o.yourPartner} ${wonOrLost(o)} ${score(o)} vs ${o.opponents[0]} & ${o.opponents[1]} · team rating ${signed(o.delta)}, now ${o.rating}.`,
    url: '/doubles',
    tag: `doubles-${o.matchId}`,
  };
}

// To the team that recorded a doubles match, if an opponent declines it.
export function doublesDeclined(
  o: Result & { matchId: string; decliner: string; opponents: [string, string] },
): PushMessage {
  return {
    title: `${o.decliner} declined your doubles match`,
    body: `Your ${score(o)} ${o.youWon ? 'win' : 'loss'} vs ${o.opponents[0]} & ${o.opponents[1]} won't count.`,
    url: '/doubles',
    tag: `doubles-${o.matchId}`,
  };
}

// --- Tournaments ---------------------------------------------------------------

const tournamentPage = (tournamentId: string) => `/tournaments/${tournamentId}`;

// To every player who can register (on the leaderboard) when an admin opens a
// tournament.
export function tournamentOpened(o: { tournamentId: string; tournament: string }): PushMessage {
  return {
    title: `New tournament: ${o.tournament}`,
    body: 'Registration is open until kickoff. Tap to sign up.',
    url: tournamentPage(o.tournamentId),
    tag: `tournament-${o.tournamentId}`,
  };
}

// To each player once the draw is made: who they play first. `winnerOf` is
// set instead of `opponent` after a round-1 bye whose next opponent comes from
// a match still to play.
export function tournamentDrawn(o: {
  tournamentId: string;
  tournament: string;
  round: number;
  opponent: string | null;
  winnerOf: [string, string] | null;
}): PushMessage {
  const next = o.opponent ? o.opponent : o.winnerOf ? `the winner of ${o.winnerOf[0]} v ${o.winnerOf[1]}` : null;
  let body: string;
  if (o.round === 1 && next) body = `Round 1: you play ${next}. Good luck!`;
  else if (next) body = `You have a bye in round 1, then you play ${next}.`;
  else body = 'Tap to see your place in the bracket.';
  return {
    title: `${o.tournament}: the draw is out`,
    body,
    url: tournamentPage(o.tournamentId),
    tag: `tournament-${o.tournamentId}`,
  };
}

// To the registered players when an admin moves the kickoff.
export function tournamentRescheduled(o: { tournamentId: string; tournament: string }): PushMessage {
  return {
    title: `${o.tournament}: kickoff moved`,
    body: "You're still registered. Tap to see the new time.",
    url: tournamentPage(o.tournamentId),
    tag: `tournament-${o.tournamentId}`,
  };
}

// To the registered players when an admin cancels before the draw.
export function tournamentCancelled(o: { tournamentId: string; tournament: string }): PushMessage {
  return {
    title: `${o.tournament} is cancelled`,
    body: 'The organizer called it off before the draw.',
    url: tournamentPage(o.tournamentId),
    tag: `tournament-${o.tournamentId}`,
  };
}

// --- Tiers ---------------------------------------------------------------------

// To a player who just moved up a tier (or got their first one at 3 matches).
export function tierPromotion(o: {
  from: Tier;
  to: Tier;
  next: { tier: Tier; rating: number } | null;
}): PushMessage {
  const name = `${TIER_NAMES[o.to]} ${TIER_EMOJI[o.to]}`.trim();
  return {
    title: o.from === 'unranked' ? `You're placed in ${name}` : `Promoted to ${name}`,
    body: o.next
      ? `Next up: ${TIER_NAMES[o.next.tier]} at ${o.next.rating}.`
      : 'The top tier. Top the leaderboard to become Legend.',
    url: '/profile',
    tag: 'tier',
  };
}

// --- Titles --------------------------------------------------------------------

export type Unlock = { name: string; emoji: string; description: string; tournament?: string };

// To a player who just earned one or more titles (all from one result).
export function titlesUnlocked(unlocks: Unlock[]): PushMessage {
  const champion = unlocks.find((u) => u.tournament);
  const names = unlocks.map((u) => u.name).join(', ');
  if (champion) {
    return {
      title: `Champion of ${champion.tournament} 🏆`,
      body: unlocks.length > 1
        ? `New titles: ${names}. A gold laurel now goes around your avatar.`
        : 'A new title, and a gold laurel now goes around your avatar.',
      url: '/profile',
      tag: 'titles',
    };
  }
  if (unlocks.length === 1) {
    const [u] = unlocks;
    return {
      title: `New title: ${u.name} ${u.emoji}`,
      body: `${u.description}. Show it under your name from your profile.`,
      url: '/profile',
      tag: 'titles',
    };
  }
  return {
    title: `${unlocks.length} new titles`,
    body: `${names}. Show one under your name from your profile.`,
    url: '/profile',
    tag: 'titles',
  };
}
