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
  const winningGames = iWon ? myGames : opponentGames;
  const losingGames = iWon ? opponentGames : myGames;
  const margin = winningGames - losingGames;

  let pool: readonly string[];
  if (Math.abs(delta) >= UPSET_DELTA_THRESHOLD) {
    pool = iWon ? WIN_UPSET : LOSS_UPSET;
  } else if (margin === 1) {
    pool = iWon ? WIN_CLOSE : LOSS_CLOSE;
  } else if (losingGames === 0) {
    pool = iWon ? WIN_BLOWOUT : LOSS_BLOWOUT;
  } else {
    pool = iWon ? WIN_NORMAL : LOSS_NORMAL;
  }

  return fill(pick(pool), { opp: opponentName });
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
