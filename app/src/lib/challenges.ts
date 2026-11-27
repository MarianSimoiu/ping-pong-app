import { thisWeek, type ChallengeOpponent, type ChallengeState } from '@/lib/challengeRules';
import * as demo from '@/lib/demo';
import { DEMO } from '@/lib/env';
import { functionErrorMessage, supabase } from '@/lib/supabase';

// Weekly challenges (migration 0031, docs/RATING.md §6): loading yours and
// switching them on or off. The rules themselves are in challengeRules.ts.
// Switched on, a player gets 3 opponents every week (Monday to Sunday, club
// time), picked so they play people they haven't played much. A challenge
// match is best of 3 or 5, as the two agree.

export * from '@/lib/challengeRules';

const one = <T>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null));

export async function fetchChallengeState(playerId: string): Promise<ChallengeState> {
  if (DEMO) return demo.demoChallengeState();
  const week = thisWeek();
  const [enrolment, challenges] = await Promise.all([
    supabase.from('challenge_players').select('starts_on').eq('player_id', playerId).maybeSingle(),
    supabase
      .from('challenges')
      .select(
        'player_id, opponent_id, result, multiplier, match_id, created_at, ' +
          'player:players!challenges_player_id_fkey(display_name, avatar_url), ' +
          'opponent:players!challenges_opponent_id_fkey(display_name, avatar_url), ' +
          'match:matches(player_a, games:match_games(score_a, score_b))',
      )
      .eq('week_start', week)
      .or(`player_id.eq.${playerId},opponent_id.eq.${playerId}`)
      .order('created_at'),
  ]);
  if (enrolment.error) throw enrolment.error;
  if (challenges.error) throw challenges.error;
  const rows = (challenges.data ?? []) as any[];
  const mineRows = rows.filter((r) => r.player_id === playerId);
  const theirRows = rows.filter((r) => r.opponent_id === playerId);

  // The opponents' ratings, and your rating change from the ones played.
  const opponentIds = mineRows.map((r) => r.opponent_id);
  const matchIds = mineRows.map((r) => r.match_id).filter(Boolean);
  const [ratings, events] = await Promise.all([
    opponentIds.length
      ? supabase.from('player_ratings').select('player_id, rating').in('player_id', opponentIds)
      : Promise.resolve({ data: [], error: null }),
    matchIds.length
      ? supabase.from('rating_events').select('match_id, delta').eq('player_id', playerId).in('match_id', matchIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (ratings.error) throw ratings.error;
  if (events.error) throw events.error;
  const ratingOf = new Map((ratings.data ?? []).map((r: any) => [r.player_id, r.rating as number]));
  const deltaOf = new Map((events.data ?? []).map((e: any) => [e.match_id, e.delta as number]));

  return {
    week,
    startsOn: enrolment.data?.starts_on ?? null,
    mine: mineRows.map((r): ChallengeOpponent => {
      const opponent = one<any>(r.opponent);
      const match = one<any>(r.match);
      let score: ChallengeOpponent['score'] = null;
      if (match) {
        const iAmA = match.player_a === playerId;
        const games = (match.games ?? []) as { score_a: number; score_b: number }[];
        const aWins = games.filter((g) => g.score_a > g.score_b).length;
        const bWins = games.length - aWins;
        score = { mine: iAmA ? aWins : bWins, theirs: iAmA ? bWins : aWins };
      }
      return {
        opponentId: r.opponent_id,
        name: opponent?.display_name ?? 'Someone',
        avatarUrl: opponent?.avatar_url ?? null,
        rating: ratingOf.get(r.opponent_id) ?? null,
        result: r.result,
        multiplier: r.multiplier,
        delta: r.match_id ? (deltaOf.get(r.match_id) ?? null) : null,
        score,
        mutual: theirRows.some((t) => t.player_id === r.opponent_id),
      };
    }),
    pickedBy: theirRows
      .filter((t) => t.result === null && !mineRows.some((r) => r.opponent_id === t.player_id))
      .map((t) => {
        const player = one<any>(t.player);
        return { playerId: t.player_id, name: player?.display_name ?? 'Someone', avatarUrl: player?.avatar_url ?? null };
      }),
  };
}

// Switch challenges on (from this week while it's still Monday to Wednesday,
// if asked; else from next Monday) or off. The Monday you start from, or null.
export async function setChallenges(on: boolean, startThisWeek = false): Promise<string | null> {
  if (DEMO) return demo.demoSetChallenges(on, startThisWeek);
  const { data, error } = await supabase.functions.invoke<{ startsOn: string | null }>('challenge-settings', {
    body: { on, thisWeek: startThisWeek },
  });
  if (error) throw new Error(await functionErrorMessage(error));
  return data?.startsOn ?? null;
}
