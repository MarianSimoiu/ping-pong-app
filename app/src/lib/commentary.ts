// Hype play-by-play commentary. Pure, no I/O — picks a line from a pool based
// on real match context (score margin, rating delta, streak length) so the
// jokes are grounded in what actually happened, not generic filler.

// A single-match rating swing at or above this is treated as an "upset" —
// the Glicko-2 engine already makes big deltas rare unless the result was
// genuinely surprising, so this doubles as a decent surprise detector.
export const UPSET_DELTA_THRESHOLD = 15;

// Minimum consecutive same-result matches before a streak banner shows.
export const STREAK_MIN = 3;

function pick(pool: readonly string[]): string {
  return pool[Math.floor(Math.random() * pool.length)];
}

function fill(line: string, vars: Record<string, string | number>): string {
  return line.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`));
}

// Shared margin read (blowout / close / normal) used by both the confirmed
// result line and the pending-confirmation teaser.
function marginCategory(
  iWon: boolean,
  myGames: number,
  opponentGames: number,
): 'blowout' | 'close' | 'normal' {
  const winningGames = iWon ? myGames : opponentGames;
  const losingGames = iWon ? opponentGames : myGames;
  if (winningGames - losingGames === 1) return 'close';
  if (losingGames === 0) return 'blowout';
  return 'normal';
}

// --- match result --------------------------------------------------------

const WIN_BLOWOUT = [
  "SWEPT! Not a single game dropped — {opp} didn't just lose, they got put on a highlight reel.",
  'STRAIGHT SETS. Ruthless. Efficient. Somebody get this player a towel and a contract.',
  "That's a sweep, folks! {opp} came to play — turns out they were playing the wrong sport.",
];

const WIN_CLOSE = [
  "PHEW. That one went the distance. A nail-biter against {opp} — survive and advance.",
  "Down to the wire! Could've gone either way, but {opp} blinked first.",
  "That's what we call a WAR. Every point mattered. You'll feel that one tomorrow.",
];

const WIN_UPSET = [
  'WAIT. WAIT. Did that just happen?! Nobody saw that coming against {opp}. NOBODY.',
  'The rating gods have spoken and they are STUNNED. That is a statement win over {opp}.',
  'Somebody check the scoreboard again — {opp} just got knocked off their pedestal.',
];

const WIN_NORMAL = [
  "Chalk up another one. Solid, professional, no drama — that's how you do business against {opp}.",
  "A win's a win, and this one goes in the books against {opp}.",
  'Clean, controlled, and exactly what the rating algorithm ordered.',
];

const LOSS_BLOWOUT = [
  'Rough night. {opp} brought the lumber and there was nothing to be done about it. Onward.',
  "That one's going straight in the vault marked 'never speak of again.'",
  '{opp} put on an absolute clinic. Take the L, watch some film, come back stronger.',
];

const LOSS_CLOSE = [
  "SO close. A heartbreaker against {opp} — a couple points the other way and we're telling a very different story.",
  'That one hurts. Fought to the very last point against {opp} and came up just short.',
  "Give {opp} credit — that was a dogfight, and it could've gone either way.",
];

const LOSS_UPSET = [
  'OHHHH. Did NOT see that coming. {opp} just pulled off the upset of the week.',
  'The favorite falls! {opp} just tore up the script against the odds.',
  'Well, that is humbling. {opp} had the game plan and executed it perfectly.',
];

const LOSS_NORMAL = [
  "Not your night. Chin up, the ladder's long and there's always next time.",
  'A loss against {opp}. Happens to everyone — shake it off.',
];

// --- pending confirmation (before the viewer has ruled on it) --------------

const PENDING_WIN_BLOWOUT = [
  "STOP THE TAPE! {opp} says you SWEPT 'em — just need your word to make it OFFICIAL, champ.",
  '{opp} is calling it a blowout in YOUR favor. Smash that Confirm button and seal the deal!',
  "Word on the street from {opp}: you ran the table. One tap and the judges make it history.",
];

const PENDING_WIN_CLOSE = [
  "{opp} says it went the distance — and YOU came out on top. Confirm it before they change their mind!",
  "A nail-biter, per {opp}'s own scorecard, with YOUR name in the win column. Make it official!",
  'Tight one! {opp} is conceding the W. Make the people — er, the ratings — believe it. Confirm up!',
];

const PENDING_WIN_NORMAL = [
  "{opp} is on the record: you took this one. Tap Confirm and let the rating book do its thing.",
  "Straightforward W, straight from {opp}'s mouth. One tap seals it, champ.",
  '{opp} logged it, you won it. Make it OFFICIAL.',
];

const PENDING_LOSS_BLOWOUT = [
  'Uh oh — {opp} is claiming a SWEEP over you. Confirm if that\'s the real story, or throw the flag and Decline!',
  '{opp} says they ran you off the table. Your call, champ: Confirm or Decline.',
  'Rough claim incoming from {opp}: total domination. You\'ve got final say here.',
];

const PENDING_LOSS_CLOSE = [
  "{opp} says it was close but they edged you out. Confirm the heartbreaker, or Decline if you remember it differently!",
  'A dogfight, per {opp} — and they\'re claiming the W. Your call: Confirm or Decline.',
  'So close, says {opp} — and they got the nod. Make the call, champ.',
];

const PENDING_LOSS_NORMAL = [
  "{opp} is calling this one a win for THEM. Confirm if that's fair, or Decline if it ain't!",
  "{opp}'s version: they got you. You've got the final whistle — Confirm or Decline.",
  '{opp} logged a W over you. The people\'s court (that\'s YOU) decides: Confirm or Decline.',
];

const DECLINE = [
  "Match waved off. The scorer's table says 'that never happened.'",
  'Declined! Sometimes the official record just needs a mulligan.',
  'Rejected — no rating movement, no hard feelings (probably).',
];

const CHAMPION = [
  '{name} STEAMROLLS the field! Ladies and gentlemen, we have our CHAMPION!',
  '{name} takes the trophy! An absolute clinic from start to finish!',
  "IT'S OVER! {name} stands alone at the top of the podium!",
  '{name} closes it out in STYLE — your tournament champion!',
  'The crowd goes wild! {name} is your undisputed champion!',
];

const HOME_TIPS = [
  'Beat a weaker opponent and the judges shrug. UPSET the favorite and the scoreboard EXPLODES. That is the game.',
  'Play the same opponent five times in a day? After the second one, the refs start docking style points. Go find someone new.',
  'Sit out too long and that rating gets rusty — the algorithm does not forget, but it does get suspicious.',
  'Every match is being scored, folks — and the computer does not care about your feelings, only your opponent’s rating.',
  'New to the ladder? Your first ten matches move FAST. Buckle up.',
];

const STREAK_WIN = [
  '\u{1F525} {count}-match win streak! Is ANYONE gonna stop this?!',
  '\u{1F525} {count} in a row! We might be watching a legend in the making.',
  "\u{1F525} On a {count}-match heater — the house is on fire and nobody's put it out yet.",
];

const STREAK_LOSS = [
  '❄️ {count} losses in a row. A cold spell — every player goes through one.',
  "❄️ {count} straight L's. Time to regroup and come back swinging.",
];

export function pickMatchResultLine(opts: {
  iWon: boolean;
  myGames: number;
  opponentGames: number;
  opponentName: string;
  delta: number;
}): string {
  const { iWon, myGames, opponentGames, opponentName, delta } = opts;

  let pool: readonly string[];
  if (Math.abs(delta) >= UPSET_DELTA_THRESHOLD) {
    pool = iWon ? WIN_UPSET : LOSS_UPSET;
  } else {
    const cat = marginCategory(iWon, myGames, opponentGames);
    pool =
      cat === 'close'
        ? iWon ? WIN_CLOSE : LOSS_CLOSE
        : cat === 'blowout'
          ? iWon ? WIN_BLOWOUT : LOSS_BLOWOUT
          : iWon ? WIN_NORMAL : LOSS_NORMAL;
  }

  return fill(pick(pool), { opp: opponentName });
}

// The teaser shown on the pending card itself, before the viewer has
// confirmed or declined — so no rating delta exists yet to call an upset.
export function pickPendingLine(opts: {
  submitterName: string;
  iWon: boolean;
  myGames: number;
  opponentGames: number;
}): string {
  const { submitterName, iWon, myGames, opponentGames } = opts;
  const cat = marginCategory(iWon, myGames, opponentGames);
  const pool =
    cat === 'close'
      ? iWon ? PENDING_WIN_CLOSE : PENDING_LOSS_CLOSE
      : cat === 'blowout'
        ? iWon ? PENDING_WIN_BLOWOUT : PENDING_LOSS_BLOWOUT
        : iWon ? PENDING_WIN_NORMAL : PENDING_LOSS_NORMAL;

  return fill(pick(pool), { opp: submitterName });
}

export function pickDeclineLine(): string {
  return pick(DECLINE);
}

export function pickChampionLine(name: string): string {
  return fill(pick(CHAMPION), { name });
}

export function pickHomeTip(): string {
  return pick(HOME_TIPS);
}

export function pickStreakLine(count: number, kind: 'win' | 'loss'): string | null {
  if (count < STREAK_MIN) return null;
  const pool = kind === 'win' ? STREAK_WIN : STREAK_LOSS;
  return fill(pick(pool), { count });
}
