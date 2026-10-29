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
