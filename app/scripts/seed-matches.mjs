#!/usr/bin/env node
// Seeds N real, confirmed matches between two existing players by calling the
// actual submit-match / confirm-match Edge Functions (not raw table inserts),
// so the real Glicko-2 engine and repeat-opponent guard run exactly as they
// would in the app. Useful for quickly testing the leaderboard gate
// (MIN_MATCHES_FOR_LEADERBOARD) and the provisional cutoff (10 matches).
//
// Usage (run from the app/ directory):
//   node scripts/seed-matches.mjs <playerA email> <playerA password> <playerB email> <playerB password> [count]
//
// Credentials are read from your own command line and never leave your
// machine. count defaults to 10.
//
// Note: all seeded matches happen within minutes of each other, so the
// repeat-opponent guard (repeatFactor in glicko2.ts) will damp the rating
// change toward zero from the 3rd match onward *today* between this pair —
// matches_played still reaches `count` and clears every leaderboard/
// provisional gate, but don't expect the rating itself to move much past
// the first couple of games. That's the anti-farming guard working as
// designed, not a bug.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnv(path) {
  const vars = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (match) vars[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return vars;
}

const [, , emailA, passwordA, emailB, passwordB, countArg] = process.argv;
if (!emailA || !passwordA || !emailB || !passwordB) {
  console.error(
    'Usage: node scripts/seed-matches.mjs <playerA email> <playerA password> <playerB email> <playerB password> [count]',
  );
  process.exit(1);
}
const count = Number(countArg) || 10;

const env = loadEnv(new URL('../.env', import.meta.url));
const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !anonKey) {
  console.error('EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY not found in app/.env');
  process.exit(1);
}

async function signIn(email, password) {
  const client = createClient(supabaseUrl, anonKey);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  const { data: player, error: playerErr } = await client
    .from('players')
    .select('id, display_name')
    .eq('user_id', data.user.id)
    .single();
  if (playerErr || !player) throw new Error(`No player row for ${email}: ${playerErr?.message}`);
  return { client, playerId: player.id, displayName: player.display_name };
}

function gamesFor(aWins) {
  // Clean, non-deuce, best-of-3 scores. `aWins` = true means the submitter's
  // side (score_a) wins 2-0; false means the opponent (score_b) wins 2-0.
  const win = [11, 7];
  const lose = [7, 11];
  return aWins ? [win, win] : [lose, lose];
}

async function main() {
  const a = await signIn(emailA, passwordA);
  const b = await signIn(emailB, passwordB);
  console.log(`Signed in as ${a.displayName} (${a.playerId}) and ${b.displayName} (${b.playerId})`);

  for (let i = 0; i < count; i++) {
    // Alternate who submits, and mix up the winner so it isn't a trivial sweep.
    const submitterIsA = i % 2 === 0;
    const submitter = submitterIsA ? a : b;
    const confirmer = submitterIsA ? b : a;
    const submitterWins = i % 3 !== 2; // ~2/3 of games go to the submitter

    const games = gamesFor(submitterWins).map(([x, y], idx) => ({
      game_no: idx + 1,
      score_a: x,
      score_b: y,
    }));

    const { data: submitData, error: submitErr } = await submitter.client.functions.invoke(
      'submit-match',
      { body: { opponentId: confirmer.playerId, bestOf: 3, games } },
    );
    if (submitErr) throw new Error(`submit-match failed on game ${i + 1}: ${submitErr.message}`);
    const matchId = submitData.matchId;

    const { error: confirmErr } = await confirmer.client.functions.invoke('confirm-match', {
      body: { matchId, action: 'confirm' },
    });
    if (confirmErr) throw new Error(`confirm-match failed on game ${i + 1}: ${confirmErr.message}`);

    const winnerName = submitterWins ? submitter.displayName : confirmer.displayName;
    console.log(`Game ${i + 1}/${count}: ${submitter.displayName} submitted, ${winnerName} won, confirmed by ${confirmer.displayName}`);
  }

  const { data: ratings } = await a.client
    .from('player_ratings')
    .select('player_id, rating, matches_played')
    .in('player_id', [a.playerId, b.playerId]);
  console.log('\nFinal state:');
  for (const r of ratings ?? []) {
    const name = r.player_id === a.playerId ? a.displayName : b.displayName;
    console.log(`  ${name}: rating ${Math.round(r.rating)}, matches_played ${r.matches_played}`);
  }
  console.log(
    '\nDone. Remember: repeated same-day matches between the same two players barely move the ' +
      'rating past the first couple of games (the repeat-opponent guard) — matches_played still ' +
      'climbed normally, so the leaderboard gate and provisional cutoff should now behave as expected.',
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
