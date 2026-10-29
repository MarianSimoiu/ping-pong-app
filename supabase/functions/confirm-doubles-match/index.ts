// Edge Function: confirm-doubles-match
//
// One of the two OPPONENTS confirms or declines a pending doubles match (the
// submitter's team can't). On confirm, both teams' ratings are computed NOW
// (current values + the same-teams repeat guard) and applied atomically; on
// decline, the match is marked rejected and never affects ratings. The team
// that recorded it gets a push notification either way, and so does the
// confirmer's partner when it's confirmed.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { computeTeamRatingUpdate, type TeamRow } from '../_shared/doubles.ts';
import { roundRating } from '../_shared/engine.ts';
import { repeatFactor } from '../_shared/glicko2.ts';
import { doublesConfirmed, doublesDeclined, gamesWon } from '../_shared/messages.ts';
import { afterResponse, notifyPlayers } from '../_shared/notify.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

type Body = { matchId?: string; action?: 'confirm' | 'decline' };
type Pair = { player_low: string; player_high: string };

const one = <T>(x: T | T[] | null): T | null => (Array.isArray(x) ? x[0] ?? null : x);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await asUser.auth.getUser();
    if (userErr || !userData.user) return jsonResponse({ error: 'Not authenticated' }, 401);

    const body = (await req.json()) as Body;
    const { matchId, action = 'confirm' } = body;
    if (!matchId) return jsonResponse({ error: 'matchId is required' }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: caller, error: callerErr } = await admin
      .from('players')
      .select('id, display_name')
      .eq('user_id', userData.user.id)
      .single();
    if (callerErr || !caller) return jsonResponse({ error: 'Player profile not found' }, 404);

    const { data: match, error: mErr } = await admin
      .from('doubles_matches')
      .select(
        'id, team_a, team_b, winner_team, status, created_by, recorders:teams!doubles_matches_team_a_fkey(player_low, player_high), opponents:teams!doubles_matches_team_b_fkey(player_low, player_high)',
      )
      .eq('id', matchId)
      .single();
    if (mErr || !match) return jsonResponse({ error: 'Match not found' }, 404);
    if (match.status !== 'pending') return jsonResponse({ error: 'This match is no longer pending' }, 400);

    const opponents = one(match.opponents as Pair | Pair[] | null);
    const recorders = one(match.recorders as Pair | Pair[] | null);
    if (!opponents || ![opponents.player_low, opponents.player_high].includes(caller.id)) {
      return jsonResponse({ error: 'Only one of the opponents can confirm this match' }, 403);
    }

    // Everyone involved, for the notifications.
    const callerPartner = opponents.player_low === caller.id ? opponents.player_high : opponents.player_low;
    const submitter: string = match.created_by;
    const submitterPartner = recorders?.player_low === submitter ? recorders.player_high : recorders?.player_low;
    const { data: people } = await admin
      .from('players')
      .select('id, display_name')
      .in('id', [submitter, submitterPartner, callerPartner].filter(Boolean));
    const nameOf = (id: string | undefined) => people?.find((p) => p.id === id)?.display_name ?? 'Someone';
    const { data: gameRows } = await admin.from('doubles_games').select('score_a, score_b').eq('match_id', matchId);
    const games = gamesWon(gameRows ?? []);
    const recordersResult = { youWon: match.winner_team === match.team_a, yourGames: games.a, theirGames: games.b };
    const confirmingTeam: [string, string] = [caller.display_name, nameOf(callerPartner)];
    const recordingTeam: string[] = [submitter, submitterPartner].filter((id): id is string => Boolean(id));

    if (action === 'decline') {
      const { error: rejErr } = await admin.rpc('reject_doubles_match', { match_id: matchId });
      if (rejErr) return jsonResponse({ error: rejErr.message }, 500);
      await afterResponse(
        notifyPlayers(admin, recordingTeam, doublesDeclined({
          matchId,
          decliner: caller.display_name,
          opponents: confirmingTeam,
          ...recordersResult,
        })),
      );
      return jsonResponse({ status: 'rejected' });
    }

    // Confirm: compute and apply both teams' rating update now.
    const { data: teamRows, error: tErr } = await admin
      .from('teams')
      .select('id, rating, rd, volatility, matches_played, last_played_at')
      .in('id', [match.team_a, match.team_b]);
    if (tErr || !teamRows || teamRows.length !== 2) {
      return jsonResponse({ error: 'Could not load team ratings' }, 500);
    }
    const teamA = teamRows.find((t) => t.id === match.team_a) as TeamRow;
    const teamB = teamRows.find((t) => t.id === match.team_b) as TeamRow;

    // Repeat guard: confirmed matches between these two teams in the last 24h.
    const since = new Date(Date.now() - DAY_MS).toISOString();
    const { count: priorToday } = await admin
      .from('doubles_matches')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'confirmed')
      .gte('played_at', since)
      .or(
        `and(team_a.eq.${match.team_a},team_b.eq.${match.team_b}),` +
          `and(team_a.eq.${match.team_b},team_b.eq.${match.team_a})`,
      );
    const factor = repeatFactor(priorToday ?? 0);

    const update = computeTeamRatingUpdate({
      teamA,
      teamB,
      aWon: match.winner_team === match.team_a,
      factor,
      now: new Date(),
    });

    const { error: confirmErr } = await admin.rpc('confirm_doubles_match', {
      payload: { match_id: matchId, confirmed_by: caller.id, events: update.events, ratings: update.ratings },
    });
    if (confirmErr) return jsonResponse({ error: confirmErr.message }, 500);

    const change = (before: { rating: number }, after: { rating: number }) => ({
      delta: Math.round(after.rating - before.rating),
      rating: Math.round(after.rating),
    });
    await afterResponse(
      Promise.all([
        // The team that recorded it, each with their own partner's name.
        ...recordingTeam.map((recipient) =>
          notifyPlayers(admin, [recipient], doublesConfirmed({
            matchId,
            confirmer: caller.display_name,
            yourPartner: nameOf(recordingTeam.find((id) => id !== recipient)),
            opponents: confirmingTeam,
            recordedByYourTeam: true,
            ...recordersResult,
            ...change(update.aBefore, update.aAfter),
          }))
        ),
        // The confirmer's partner.
        notifyPlayers(admin, [callerPartner], doublesConfirmed({
          matchId,
          confirmer: caller.display_name,
          yourPartner: caller.display_name,
          opponents: [nameOf(submitter), nameOf(submitterPartner)],
          recordedByYourTeam: false,
          youWon: match.winner_team === match.team_b,
          yourGames: games.b,
          theirGames: games.a,
          ...change(update.bBefore, update.bAfter),
        })),
      ]),
    );

    // The confirmer is always on team B: report their team's change.
    return jsonResponse({
      status: 'confirmed',
      repeatFactor: factor,
      yourTeam: {
        delta: Math.round(update.bAfter.rating - update.bBefore.rating),
        rating: Math.round(update.bAfter.rating),
        rd: Math.round(update.bAfter.rd),
      },
      teamA: { before: roundRating(update.aBefore), after: roundRating(update.aAfter) },
      teamB: { before: roundRating(update.bBefore), after: roundRating(update.bAfter) },
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
