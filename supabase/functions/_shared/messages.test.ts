// Run with: deno test supabase/functions/_shared
import { assertEquals } from 'jsr:@std/assert@1';

import {
  doublesConfirmed,
  doublesDeclined,
  doublesToConfirm,
  gamesWon,
  singlesConfirmed,
  singlesDeclined,
  singlesToConfirm,
} from './messages.ts';

Deno.test('games won per side, from stored scores', () => {
  assertEquals(gamesWon([{ score_a: 11, score_b: 7 }, { score_a: 9, score_b: 11 }, { score_a: 12, score_b: 10 }]), { a: 2, b: 1 });
  assertEquals(gamesWon([]), { a: 0, b: 0 });
});

Deno.test('singles: to confirm, confirmed, declined', () => {
  assertEquals(singlesToConfirm({ matchId: 'm1', submitter: 'Silviu', youWon: false, yourGames: 1, theirGames: 3 }), {
    title: 'Silviu recorded a match',
    body: 'You lost 1–3. Tap to confirm or decline.',
    url: '/',
    tag: 'match-m1',
  });
  assertEquals(
    singlesConfirmed({ matchId: 'm1', opponent: 'Alin', youWon: true, yourGames: 3, theirGames: 1, delta: 14, rating: 1612 }),
    { title: 'Alin confirmed your match', body: 'You won 3–1 · rating +14, now 1612.', url: '/', tag: 'match-m1' },
  );
  assertEquals(
    singlesConfirmed({ matchId: 'm2', opponent: 'Alin', youWon: false, yourGames: 0, theirGames: 2, delta: -9, rating: 1480 }).body,
    'You lost 0–2 · rating -9, now 1480.',
  );
  assertEquals(singlesDeclined({ matchId: 'm1', opponent: 'Alin', youWon: true, yourGames: 3, theirGames: 1 }), {
    title: 'Alin declined your match',
    body: "Your 3–1 win won't count.",
    url: '/',
    tag: 'match-m1',
  });
});

Deno.test('doubles: to confirm, confirmed (both sides), declined', () => {
  assertEquals(
    doublesToConfirm({
      matchId: 'd1',
      submitter: 'Silviu',
      submitterPartner: 'Ben',
      yourPartner: 'Dana',
      youWon: false,
      yourGames: 1,
      theirGames: 2,
    }),
    {
      title: 'Silviu recorded a doubles match',
      body: 'You & Dana lost 1–2 vs Silviu & Ben. Tap to confirm or decline.',
      url: '/',
      tag: 'doubles-d1',
    },
  );
  const result = { matchId: 'd1', confirmer: 'Cris', youWon: true, yourGames: 2, theirGames: 1, delta: 12, rating: 1590 };
  assertEquals(doublesConfirmed({ ...result, yourPartner: 'Ben', opponents: ['Cris', 'Dana'], recordedByYourTeam: true }), {
    title: 'Cris confirmed your doubles match',
    body: 'You & Ben won 2–1 vs Cris & Dana · team rating +12, now 1590.',
    url: '/doubles',
    tag: 'doubles-d1',
  });
  assertEquals(
    doublesConfirmed({
      ...result,
      youWon: false,
      yourGames: 1,
      theirGames: 2,
      delta: -11,
      rating: 1520,
      yourPartner: 'Cris',
      opponents: ['Silviu', 'Ben'],
      recordedByYourTeam: false,
    }),
    {
      title: 'Cris confirmed a doubles match',
      body: 'You & Cris lost 1–2 vs Silviu & Ben · team rating -11, now 1520.',
      url: '/doubles',
      tag: 'doubles-d1',
    },
  );
  assertEquals(
    doublesDeclined({ matchId: 'd1', decliner: 'Cris', opponents: ['Cris', 'Dana'], youWon: true, yourGames: 2, theirGames: 1 }),
    { title: 'Cris declined your doubles match', body: "Your 2–1 win vs Cris & Dana won't count.", url: '/doubles', tag: 'doubles-d1' },
  );
});
