// Run with: deno test supabase/functions/_shared
import { assertEquals } from 'jsr:@std/assert@1';

import {
  challengesAnnounced,
  challengesReminder,
  doublesConfirmed,
  doublesDeclined,
  doublesToConfirm,
  gamesWon,
  matchOverdue,
  matchScheduled,
  matchTimeDeclined,
  matchTimeProposed,
  singlesConfirmed,
  singlesDeclined,
  singlesToConfirm,
  tournamentCancelled,
  tournamentDrawn,
  tournamentOpened,
  tournamentRegistered,
  tournamentRescheduled,
  tournamentResultByOrganizer,
  tournamentResultConfirmed,
  tournamentResultDeclined,
  tournamentResultToConfirm,
  walkoverGiven,
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

Deno.test('tournaments: opened, drawn (match, bye then opponent, bye then winner of), moved, cancelled', () => {
  const t = { tournamentId: 't1', tournament: 'Winter Cup' };
  assertEquals(tournamentOpened(t), {
    title: 'New tournament: Winter Cup',
    body: 'Registration is open until kickoff. Tap to sign up.',
    url: '/tournaments/t1',
    tag: 'tournament-t1',
  });
  assertEquals(tournamentDrawn({ ...t, round: 1, opponent: 'Alin', winnerOf: null }), {
    title: 'Winter Cup: the draw is out',
    body: 'Round 1: you play Alin. Good luck!',
    url: '/tournaments/t1',
    tag: 'tournament-t1',
  });
  assertEquals(
    tournamentDrawn({ ...t, round: 2, opponent: 'Ana', winnerOf: null }).body,
    'You have a bye in round 1, then you play Ana.',
  );
  assertEquals(
    tournamentDrawn({ ...t, round: 2, opponent: null, winnerOf: ['Ben', 'Cris'] }).body,
    'You have a bye in round 1, then you play the winner of Ben v Cris.',
  );
  assertEquals(tournamentDrawn({ ...t, round: 2, opponent: null, winnerOf: null }).body, 'Tap to see your place in the bracket.');
  assertEquals(tournamentRescheduled(t), {
    title: 'Winter Cup: kickoff moved',
    body: "You're still registered. Tap to see the new time.",
    url: '/tournaments/t1',
    tag: 'tournament-t1',
  });
  assertEquals(tournamentCancelled(t).title, 'Winter Cup is cancelled');
});

Deno.test('match times: in the draw message, scheduled, moved, proposed, declined, overdue, walkover', () => {
  const t = { tournamentId: 't1', tournament: 'Winter Cup' };
  const at = '2026-11-16T09:00:00Z'; // Monday 11:00 in Bucharest
  assertEquals(
    tournamentDrawn({ ...t, round: 1, opponent: 'Alin', winnerOf: null, at }).body,
    "Round 1: you play Alin on Mon 16 Nov, 11:00, or earlier if you're both ready and the table's free. Good luck!",
  );
  assertEquals(
    tournamentDrawn({ ...t, round: 2, opponent: 'Ana', winnerOf: null, at }).body,
    "You have a bye in round 1, then you play Ana on Mon 16 Nov, 11:00, or earlier if you're both ready and the table's free.",
  );
  assertEquals(matchScheduled({ ...t, match: 'semifinal', opponent: 'Ana', at, moved: false }), {
    title: 'Winter Cup: your semifinal',
    body: "You play Ana on Mon 16 Nov, 11:00, or earlier if you're both ready and the table's free. Can't make it? Propose another time.",
    url: '/tournaments/t1',
    tag: 'match-time-t1',
  });
  assertEquals(matchScheduled({ ...t, match: 'final', opponent: 'Ana', at, moved: true }).body, 'You play Ana on Mon 16 Nov, 11:00 now.');
  assertEquals(matchTimeProposed({ ...t, match: 'quarterfinal', proposer: 'Ben', at }), {
    title: 'Ben wants to move your quarterfinal',
    body: 'To Mon 16 Nov, 11:00. Open Winter Cup to accept or decline.',
    url: '/tournaments/t1',
    tag: 'match-time-t1',
  });
  assertEquals(matchTimeDeclined({ ...t, match: 'quarterfinal', opponent: 'Ben', at }), {
    title: 'Ben kept your quarterfinal time',
    body: 'Still Mon 16 Nov, 11:00. You can propose another time in Winter Cup.',
    url: '/tournaments/t1',
    tag: 'match-time-t1',
  });
  assertEquals(
    matchOverdue({ ...t, match: 'round of 16 match', playerA: 'Ana', playerB: 'Ben', at }).body,
    'Ana v Ben (round of 16 match) was due Mon 16 Nov, 11:00. Record the result or give a walkover.',
  );
  // Played, but the result one player recorded isn't confirmed (0028).
  assertEquals(
    matchOverdue({ ...t, match: 'semifinal', playerA: 'Ana', playerB: 'Ben', at, recordedBy: 'Ana', waitingFor: 'Ben' }),
    {
      title: "Winter Cup: a result isn't confirmed",
      body: "Ana recorded Ana v Ben (semifinal, due Mon 16 Nov, 11:00) and Ben hasn't confirmed it. Record the result to settle it, or give a walkover.",
      url: '/tournaments/t1',
      tag: 'overdue-t1',
    },
  );
  assertEquals(walkoverGiven({ ...t, match: 'semifinal', youWon: true, opponent: 'Ben' }).title, 'Winter Cup: you go through');
  // Nothing to go through to after the final or the third-place match.
  assertEquals(walkoverGiven({ ...t, match: 'third-place match', youWon: true, opponent: 'Ben' }).title, 'Winter Cup: walkover to you');
  assertEquals(
    walkoverGiven({ ...t, match: 'third-place match', youWon: true, opponent: 'Ben' }).body,
    'The organizer gave you your third-place match against Ben as a walkover.',
  );
  assertEquals(
    walkoverGiven({ ...t, match: 'semifinal', youWon: false, opponent: 'Ana' }).body,
    'The organizer gave Ana your semifinal as a walkover.',
  );
});

Deno.test('a sign-up, to the admins: who and how many, one alert each', () => {
  const t = { tournamentId: 't1', tournament: 'Winter Cup' };
  assertEquals(tournamentRegistered({ ...t, player: 'Ana', playerId: 'p1', count: 7 }), {
    title: 'Winter Cup: Ana registered',
    body: '7 players registered so far.',
    url: '/tournaments/t1',
    tag: 'registered-t1-p1',
  });
  assertEquals(tournamentRegistered({ ...t, player: 'Ben', playerId: 'p2', count: 1 }).body, '1 player registered so far.');
});

Deno.test('tournament results: to confirm, confirmed, declined, and the organizer\'s', () => {
  const r = { tournamentId: 't1', tournament: 'Winter Cup', match: 'semifinal', matchId: 'm9' };
  assertEquals(tournamentResultToConfirm({ ...r, recorder: 'Ana', youWon: false, yourGames: 1, theirGames: 2 }), {
    title: 'Ana recorded your semifinal',
    body: 'Winter Cup: you lost 1–2. It counts once you confirm it. Tap to confirm or decline.',
    url: '/tournaments/t1',
    tag: 'result-m9',
  });
  assertEquals(
    tournamentResultConfirmed({ ...r, opponent: 'Ben', youWon: true, yourGames: 2, theirGames: 1, delta: 18, rating: 1630 }),
    {
      title: 'Ben confirmed your semifinal',
      body: 'Winter Cup: you won 2–1 · rating +18, now 1630.',
      url: '/tournaments/t1',
      tag: 'result-m9',
    },
  );
  assertEquals(tournamentResultDeclined({ ...r, opponent: 'Ben', youWon: true, yourGames: 2, theirGames: 1 }), {
    title: 'Ben declined your semifinal result',
    body: "Your 2–1 win doesn't count. Agree on the score and record it again, or ask the organizer.",
    url: '/tournaments/t1',
    tag: 'result-m9',
  });
  assertEquals(tournamentResultByOrganizer({ ...r, opponent: 'Ana', youWon: false, yourGames: 0, theirGames: 2 }), {
    title: 'Winter Cup: your semifinal result',
    body: 'The organizer recorded it: you lost 0–2 against Ana.',
    url: '/tournaments/t1',
    tag: 'result-m9',
  });
});

Deno.test('challenges: a challenge match to confirm, a boosted win, the week, the reminder', () => {
  assertEquals(
    singlesToConfirm({ matchId: 'm1', submitter: 'Ana', youWon: false, yourGames: 1, theirGames: 2, challenge: { bestOf: 3 } }),
    { title: 'Ana recorded a challenge match', body: 'You lost 1–2 (best of 3). Tap to confirm or decline.', url: '/', tag: 'match-m1' },
  );
  assertEquals(
    singlesConfirmed({ matchId: 'm1', opponent: 'Ben', youWon: true, yourGames: 3, theirGames: 1, delta: 18, rating: 1612, boost: 1.5 }).body,
    'You won 3–1 · rating +18 (⚡ challenge win +50%), now 1612.',
  );
  assertEquals(
    singlesConfirmed({ matchId: 'm1', opponent: 'Ben', youWon: true, yourGames: 2, theirGames: 0, delta: 24, rating: 1630, boost: 2 }).body,
    'You won 2–0 · rating +24 (⚡ challenge win ×2), now 1630.',
  );
  assertEquals(challengesAnnounced({ opponents: ['Ana', 'Ben', 'Cris'] }), {
    title: '⚡ Your challenges this week',
    body: 'Ana, Ben and Cris. Win them for bonus rating: +25%, then +50%, then double.',
    url: '/',
    tag: 'challenges',
  });
  assertEquals(challengesReminder({ opponents: ['Ben', 'Cris'] }), {
    title: '⚡ 2 challenges left this week',
    body: 'Ben and Cris. The week ends on Sunday.',
    url: '/',
    tag: 'challenges',
  });
  assertEquals(challengesReminder({ opponents: ['Cris'] }).title, '⚡ 1 challenge left this week');
});
