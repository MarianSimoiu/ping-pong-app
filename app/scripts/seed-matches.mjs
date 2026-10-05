#!/usr/bin/env node
// Seeds N real, confirmed matches between two existing players by calling the
// actual submit-match / confirm-match Edge Functions (not raw table inserts),
// so the real Glicko-2 engine and repeat-opponent guard run exactly as they
// would in the app. Useful for quickly testing the leaderboard gate
// (MIN_MATCHES_FOR_LEADERBOARD) and the provisional cutoff (10 matches).
//
// Admin mode: no passwords needed. Each account is signed in via an
// admin-generated one-time link (the same mechanism behind magic-link
// email sign-in), using the project's service-role key.
//
// Usage (run from the app/ directory):
//   SUPABASE_SERVICE_ROLE_KEY=<your service role key> node scripts/seed-matches.mjs <playerA email> <playerB email> [count]
//
// Get the service role key from the Supabase dashboard -> Project Settings
// -> API -> service_role (secret). It bypasses all RLS, so only ever pass it
// as an env var for this one command — never commit it or paste it anywhere
// else. count defaults to 10.
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
import WebSocket from 'ws';

// On Node < 22 there's no built-in WebSocket, and supabase-js's realtime
// client can otherwise stall waiting on one even though this script never
// uses realtime features. Providing one explicitly (its own suggested fix)
// avoids that stall.
const supabaseClientOptions = { realtime: { transport: WebSocket } };

// Safety net: make sure nothing can fail silently. Without these, a promise
// rejection that misses the main().catch() below (e.g. one that escapes via
// a dangling network call) can exit the process with no output at all.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

// Turns a silent hang into a clear, actionable error after `ms` instead of
// leaving the process stuck with no output.
function withTimeout(promise, label, ms = 20000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out after ${ms / 1000}s waiting on: ${label}`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function loadEnv(path) {
  const vars = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (match) vars[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return vars;
}

const [, , emailA, emailB, countArg] = process.argv;
if (!emailA || !emailB) {
  console.error(
    'Usage: SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/seed-matches.mjs <playerA email> <playerB email> [count]',
  );
  process.exit(1);
}
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) {
  console.error(
    'Set SUPABASE_SERVICE_ROLE_KEY (Supabase dashboard -> Project Settings -> API) as an env var for this command.',
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

// Signs in as an existing user with no password: the service-role key
// generates a one-time magic-link token for their email, and a normal
// (anon-key) client redeems it for a real session — the same session a
// user gets by clicking a magic-link email, just skipping the email step.
async function signInAsAdmin(email) {
  console.log(`[${email}] requesting a sign-in link...`);
  const admin = createClient(supabaseUrl, serviceKey, supabaseClientOptions);
  const { data: linkData, error: linkErr } = await withTimeout(
    admin.auth.admin.generateLink({ type: 'magiclink', email }),
    `generateLink for ${email}`,
  );
  if (linkErr) throw new Error(`generateLink failed for ${email}: ${linkErr.message}`);
  const hashedToken = linkData.properties?.hashed_token;
  if (!hashedToken) throw new Error(`No token generated for ${email} — does that user exist?`);
  console.log(`[${email}] got a link, redeeming it...`);

  const client = createClient(supabaseUrl, anonKey, supabaseClientOptions);
  // token_hash alone identifies the user; the API rejects passing email
  // alongside it ("Only the token_hash and type should be provided").
  const { data, error } = await withTimeout(
    client.auth.verifyOtp({ token_hash: hashedToken, type: 'magiclink' }),
    `verifyOtp for ${email}`,
  );
  if (error) throw new Error(`verifyOtp failed for ${email}: ${error.message}`);
  console.log(`[${email}] signed in, looking up their player profile...`);

  const { data: player, error: playerErr } = await withTimeout(
    client.from('players').select('id, display_name').eq('user_id', data.user.id).single(),
    `player lookup for ${email}`,
  );
  if (playerErr || !player) throw new Error(`No player row for ${email}: ${playerErr?.message}`);
  console.log(`[${email}] -> player "${player.display_name}" (${player.id})`);
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
  console.log(`Starting: ${supabaseUrl}, count=${count}`);
  const a = await signInAsAdmin(emailA);
  const b = await signInAsAdmin(emailB);
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

    const { data: submitData, error: submitErr } = await withTimeout(
      submitter.client.functions.invoke('submit-match', {
        body: { opponentId: confirmer.playerId, bestOf: 3, games },
      }),
      `submit-match for game ${i + 1}`,
    );
    if (submitErr) throw new Error(`submit-match failed on game ${i + 1}: ${submitErr.message}`);
    const matchId = submitData.matchId;

    const { error: confirmErr } = await withTimeout(
      confirmer.client.functions.invoke('confirm-match', { body: { matchId, action: 'confirm' } }),
      `confirm-match for game ${i + 1}`,
    );
    if (confirmErr) throw new Error(`confirm-match failed on game ${i + 1}: ${confirmErr.message}`);

    const winnerName = submitterWins ? submitter.displayName : confirmer.displayName;
    console.log(`Game ${i + 1}/${count}: ${submitter.displayName} submitted, ${winnerName} won, confirmed by ${confirmer.displayName}`);
  }

  const { data: ratings } = await withTimeout(
    a.client
      .from('player_ratings')
      .select('player_id, rating, matches_played')
      .in('player_id', [a.playerId, b.playerId]),
    'final ratings read',
  );
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
