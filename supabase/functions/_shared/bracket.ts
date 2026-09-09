// Single-elimination bracket generation (pure, testable).
//
// Given players in seed order (index 0 = top seed), produce every bracket node
// across all rounds. Byes (when the field isn't a power of two) are given to the
// top seeds and auto-advance. The result is persisted as `tournament_matches`.

export type NodeStatus = 'pending' | 'ready' | 'completed';

export type BracketNode = {
  round: number; // 1 = first round, increasing toward the final
  slot: number; // 0-based position within the round
  playerA: string | null;
  playerB: string | null;
  winner: string | null;
  status: NodeStatus;
};

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// Standard recursive bracket seeding for a power-of-two size, e.g. size 8 ->
// [1,8,4,5,2,7,3,6]. Pairs of consecutive entries are the first-round matchups
// (1v8, 4v5, 2v7, 3v6), keeping the top seeds apart until late rounds.
export function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    const next: number[] = [];
    for (const s of order) {
      next.push(s);
      next.push(sum - s);
    }
    order = next;
  }
  return order;
}

export function generateSingleElim(seededPlayerIds: string[]): BracketNode[] {
  const n = seededPlayerIds.length;
  if (n < 2) throw new Error('A tournament needs at least 2 participants');
  if (n > 32) throw new Error('At most 32 participants are supported');

  const size = nextPowerOfTwo(n);
  const rounds = Math.log2(size);
  const order = seedOrder(size);
  const seedToPlayer = (seed: number): string | null =>
    seed <= n ? seededPlayerIds[seed - 1] : null;

  const nodes: BracketNode[] = [];
  for (let r = 1; r <= rounds; r++) {
    const slots = size / 2 ** r;
    for (let s = 0; s < slots; s++) {
      nodes.push({ round: r, slot: s, playerA: null, playerB: null, winner: null, status: 'pending' });
    }
  }
  const nodeAt = (r: number, s: number): BracketNode =>
    nodes.find((x) => x.round === r && x.slot === s)!;

  // Fill the first round from the seed order.
  const firstRoundSlots = size / 2;
  for (let s = 0; s < firstRoundSlots; s++) {
    const node = nodeAt(1, s);
    node.playerA = seedToPlayer(order[s * 2]);
    node.playerB = seedToPlayer(order[s * 2 + 1]);
    if (node.playerA && node.playerB) node.status = 'ready';
  }

  // Advance the winner of (r, s) into its parent slot.
  const advance = (r: number, s: number, winner: string) => {
    if (r >= rounds) return; // the final has no parent
    const parent = nodeAt(r + 1, Math.floor(s / 2));
    if (s % 2 === 0) parent.playerA = winner;
    else parent.playerB = winner;
    if (parent.playerA && parent.playerB) parent.status = 'ready';
  };

  // Resolve first-round byes (exactly one player present -> auto-advance).
  for (let s = 0; s < firstRoundSlots; s++) {
    const node = nodeAt(1, s);
    const onlyOne = !!node.playerA !== !!node.playerB;
    if (onlyOne) {
      const present = (node.playerA ?? node.playerB)!;
      node.winner = present;
      node.status = 'completed';
      advance(1, s, present);
    }
  }

  return nodes;
}

// Given a completed node's coordinates, where does the winner go next?
// Returns null when the node is the final.
export function parentSlot(
  round: number,
  slot: number,
  totalRounds: number,
): { round: number; slot: number; side: 'a' | 'b' } | null {
  if (round >= totalRounds) return null;
  return { round: round + 1, slot: Math.floor(slot / 2), side: slot % 2 === 0 ? 'a' : 'b' };
}
