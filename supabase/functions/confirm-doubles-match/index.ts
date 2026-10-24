// Edge Function: confirm-doubles-match
//
// One of the two OPPONENTS confirms or declines a pending doubles match (the
// submitter's team can't). On confirm, both teams' ratings are computed NOW
// (current values + the same-teams repeat guard) and applied atomically; on
// decline, the match is marked rejected and never affects ratings.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { computeTeamRatingUpdate, type TeamRow } from '../_shared/doubles.ts';
import { roundRating } from '../_shared/engine.ts';
import { repeatFactor } from '../_shared/glicko2.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

type Body = { matchId?: string; action?: 'confirm' | 'decline' };

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
      .select('id')
      .eq('user_id', userData.user.id)
      .single();
    if (callerErr || !caller) return jsonResponse({ error: 'Player profile not found' }, 404);

    const { data: match, error: mErr } = await admin
      .from('doubles_matches')
      .select('id, team_a, team_b, winner_team, status, opponents:teams!doubles_matches_team_b_fkey(player_low, player_high)')
      .eq('id', matchId)
      .single();
    if (mErr || !match) return jsonResponse({ error: 'Match not found' }, 404);
    if (match.status !== 'pending') return jsonResponse({ error: 'This match is no longer pending' }, 400);

    const opponents = Array.isArray(match.opponents) ? match.opponents[0] : match.opponents;
    if (!opponents || ![opponents.player_low, opponents.player_high].includes(caller.id)) {
      return jsonResponse({ error: 'Only one of the opponents can confirm this match' }, 403);
    }

    if (action === 'decline') {
      const { error: rejErr } = await admin.rpc('reject_doubles_match', { match_id: matchId });
      if (rejErr) return jsonResponse({ error: rejErr.message }, 500);
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
