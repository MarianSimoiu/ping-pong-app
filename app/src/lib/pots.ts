// How a tournament's players are split into pots, and what round 1 would look
// like for each pot if the draw were made now. Pure, so the screens can show
// the rules next to the pots. Mirrors the database's tournament_live_pots view
// (migration 0012) and the draw (supabase/functions/_shared/draw.ts and
// bracket.ts): keep them in step.

export type PotPlayer = {
  playerId: string;
  pot: number | null;
  rating: number | null;
  registeredAt: string | null;
};

// 8 or more players make 4 pots, 2 to 7 make 2.
export function potCountFor(players: number): number {
  return players >= 8 ? 4 : players >= 2 ? 2 : 1;
}

// Pot sizes for a field: as equal as possible, the top pots one bigger when it
// doesn't divide evenly (Postgres's ntile).
export function potSizes(players: number): number[] {
  if (players <= 0) return [];
  const k = potCountFor(players);
  const base = Math.floor(players / k);
  return Array.from({ length: k }, (_, i) => base + (i < players % k ? 1 : 0));
}

export type RankedPlayer<T> = T & { rank: number };

export type PotGroup<T> = {
  pot: number | null; // null: a tournament from before pots existed
  players: RankedPlayer<T>[];
  rankFrom: number;
  rankTo: number;
  ratingLow: number | null;
  ratingHigh: number | null;
};

// Players ranked 1..n the way the pots were cut: by pot, then best rating,
// then whoever registered first. The pot itself comes from the server.
export function groupByPot<T extends PotPlayer>(players: T[]): PotGroup<T>[] {
  const sorted = [...players].sort(
    (a, b) =>
      (a.pot ?? 99) - (b.pot ?? 99) ||
      (b.rating ?? 0) - (a.rating ?? 0) ||
      (a.registeredAt ?? '').localeCompare(b.registeredAt ?? '') ||
      (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
  );
  const groups: PotGroup<T>[] = [];
  sorted.forEach((p, i) => {
    let group = groups[groups.length - 1];
    if (!group || group.pot !== p.pot) {
      group = { pot: p.pot, players: [], rankFrom: i + 1, rankTo: i + 1, ratingLow: null, ratingHigh: null };
      groups.push(group);
    }
    group.players.push({ ...p, rank: i + 1 });
    group.rankTo = i + 1;
    if (p.rating !== null) {
      group.ratingLow = group.ratingLow === null ? p.rating : Math.min(group.ratingLow, p.rating);
      group.ratingHigh = group.ratingHigh === null ? p.rating : Math.max(group.ratingHigh, p.rating);
    }
  });
  return groups;
}

// What round 1 would hold for each pot of these sizes. At the draw each pot
// is shuffled and seeded in order (Pot 1 gets seeds 1..n1, Pot 2 the next,
// ...); in the bracket seed s meets seed (bracket size + 1 - s), and a seed
// past the field is a bye.
export type Round1 = { byes: number; against: { pot: number; count: number }[] };

export function round1ByPot(sizes: number[]): Round1[] {
  const field = sizes.reduce((a, b) => a + b, 0);
  let bracket = 2;
  while (bracket < field) bracket *= 2;
  const potOfSeed = (seed: number) => {
    let last = 0;
    for (let i = 0; i < sizes.length; i++) {
      last += sizes[i];
      if (seed <= last) return i + 1;
    }
    return 0;
  };
  let first = 1;
  return sizes.map((size) => {
    let byes = 0;
    const against = new Map<number, number>();
    for (let seed = first; seed < first + size; seed++) {
      const opponent = bracket + 1 - seed;
      if (opponent > field) byes++;
      else against.set(potOfSeed(opponent), (against.get(potOfSeed(opponent)) ?? 0) + 1);
    }
    first += size;
    return {
      byes,
      against: [...against].sort(([a], [b]) => a - b).map(([pot, count]) => ({ pot, count })),
    };
  });
}

// One line for a pot's round 1, e.g. "Each plays someone from Pot 4",
// "All get a bye (skip round 1)", or "2 get a bye, 1 plays someone from
// Pot 2 — the draw decides who".
export function round1Text(pot: number, size: number, r: Round1): string {
  if (r.byes === size) return size === 1 ? 'Gets a bye (skips round 1)' : 'All get a bye (skip round 1)';
  if (r.byes === 0 && r.against.length === 1) {
    const [only] = r.against;
    if (only.pot === pot) return 'They play each other';
    return size === 1 ? `Plays someone from Pot ${only.pot}` : `Each plays someone from Pot ${only.pot}`;
  }
  const parts: string[] = [];
  if (r.byes > 0) parts.push(r.byes === 1 ? '1 gets a bye' : `${r.byes} get a bye`);
  for (const a of r.against) {
    if (a.pot === pot) parts.push(`${a.count} play each other`);
    else parts.push(a.count === 1 ? `1 plays someone from Pot ${a.pot}` : `${a.count} play someone from Pot ${a.pot}`);
  }
  return `${parts.join(', ')} — the draw decides who`;
}
