// Edge Function: match-schedule
//
// When tournament matches are played (migration 0018). The two players of a
// match:
//   propose   { tournamentMatchId, at }    another time (11:00-18:00 club time,
//                                           from today up to a day after the
//                                           planned day); the other is asked
//   accept    { tournamentMatchId }         the other player: the match moves
//   decline   { tournamentMatchId }         ...or keeps its time
//   withdraw  { tournamentMatchId }         the one who proposed takes it back
// Admins:
//   move      { tournamentMatchId, at }    any future time
//   dates     { tournamentId, round, startsOn, endsOn }   a round's days
//   walkover  { tournamentMatchId, winnerId }   the winner goes through unplayed
// The database checks every rule (who, when, no clash on the one table) and
// says why when it refuses. Everyone concerned gets a notification.

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { caller } from '../_shared/caller.ts';
import { matchTimeDeclined, matchTimeProposed, walkoverGiven } from '../_shared/messages.ts';
import { afterResponse, notifyEach, notifyPlayers } from '../_shared/notify.ts';
import { announceRewards } from '../_shared/rewards.ts';
import { matchName } from '../_shared/rounds.ts';
import { ADMIN_ACTIONS, announceSchedules, parseScheduleRequest } from '../_shared/schedule.ts';
import { awardSeasonPoints } from '../_shared/season.ts';
import { errorMessage, isRuleError } from '../_shared/tournaments.ts';

const refused = (error: unknown) => jsonResponse({ error: errorMessage(error) }, isRuleError(error) ? 400 : 500);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const who = await caller(req);
    if (who instanceof Response) return who;
    const { admin, playerId, isAdmin } = who;

    const parsed = parseScheduleRequest(await req.json());
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);
    const a = parsed.value;
    if ((ADMIN_ACTIONS as readonly string[]).includes(a.action) && !isAdmin) {
      return jsonResponse({ error: 'Only admins can do that' }, 403);
    }

    if (a.action === 'dates') {
      const { data: moved, error } = await admin.rpc('set_round_dates', {
        p_tournament: a.tournamentId,
        p_admin: playerId,
        p_round: a.round,
        p_starts: a.startsOn,
        p_ends: a.endsOn,
      });
      if (error) return refused(error);
      await afterResponse(announceSchedules(admin, a.tournamentId, { moved: true }));
      return jsonResponse({ moved });
    }

    // The match, for the checks below and the messages.
    const { data: m, error: mError } = await admin
      .from('tournament_matches')
      .select('id, tournament_id, round, player_a, player_b, scheduled_at, proposed_at, proposed_by, tournament:tournaments(name, size)')
      .eq('id', a.matchId)
      .maybeSingle();
    if (mError) throw mError;
    if (!m) return jsonResponse({ error: 'Match not found' }, 404);
    const t = Array.isArray(m.tournament) ? m.tournament[0] : m.tournament;
    const match = matchName(m.round, Math.log2(t.size ?? 2));
    const { data: people } = await admin
      .from('players')
      .select('id, display_name')
      .in('id', [m.player_a, m.player_b].filter(Boolean));
    const nameOf = (id: string | null) => (people ?? []).find((p) => p.id === id)?.display_name ?? 'your opponent';
    const other = m.player_a === playerId ? m.player_b : m.player_a;
    const about = { tournamentId: m.tournament_id, tournament: t.name, match };

    switch (a.action) {
      case 'propose': {
        const { error } = await admin.rpc('propose_match_time', { p_match: m.id, p_player: playerId, p_at: a.at });
        if (error) return refused(error);
        await afterResponse(
          notifyPlayers(admin, [other], matchTimeProposed({ ...about, proposer: nameOf(playerId), at: a.at })),
        );
        return jsonResponse({ proposedAt: a.at });
      }
      case 'accept':
      case 'decline':
      case 'withdraw': {
        if (a.action === 'withdraw' && m.proposed_by !== playerId) {
          return jsonResponse({ error: 'Only the player who proposed it can take it back' }, 400);
        }
        if (a.action !== 'withdraw' && m.proposed_by === playerId) {
          return jsonResponse({ error: 'The other player has to answer it' }, 400);
        }
        const { data: outcome, error } = await admin.rpc('answer_match_time', {
          p_match: m.id,
          p_player: playerId,
          p_accept: a.action === 'accept',
        });
        if (error) return refused(error);
        if (outcome === 'accepted') {
          await afterResponse(announceSchedules(admin, m.tournament_id, { skip: playerId, moved: true }));
        } else if (outcome === 'declined' && m.proposed_by) {
          await afterResponse(
            notifyPlayers(
              admin,
              [m.proposed_by],
              matchTimeDeclined({ ...about, opponent: nameOf(playerId), at: m.scheduled_at }),
            ),
          );
        }
        return jsonResponse({ outcome });
      }
      case 'move': {
        const { error } = await admin.rpc('move_tournament_match', { p_match: m.id, p_admin: playerId, p_at: a.at });
        if (error) return refused(error);
        await afterResponse(announceSchedules(admin, m.tournament_id, { moved: true }));
        return jsonResponse({ scheduledAt: a.at });
      }
      case 'walkover': {
        const { data: finished, error } = await admin.rpc('give_walkover', {
          p_match: m.id,
          p_admin: playerId,
          p_winner: a.winnerId,
        });
        if (error) return refused(error);
        const loser = a.winnerId === m.player_a ? m.player_b : m.player_a;
        await afterResponse(
          Promise.all([
            notifyEach(admin, [
              { playerId: a.winnerId, message: walkoverGiven({ ...about, youWon: true, opponent: nameOf(loser) }) },
              { playerId: loser, message: walkoverGiven({ ...about, youWon: false, opponent: nameOf(a.winnerId) }) },
            ]),
            announceRewards(admin, [a.winnerId, loser]),
            announceSchedules(admin, m.tournament_id),
          ]),
        );
        const seasonPointsAwarded = finished ? await awardSeasonPoints(admin, m.tournament_id) : false;
        return jsonResponse({ finished, seasonPointsAwarded });
      }
    }
    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (e) {
    return refused(e);
  }
});
