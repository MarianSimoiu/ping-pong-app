// 2v2 doubles: a team (a pair of players) is rated exactly like a singles
// player — same Glicko-2 engine, same inactivity decay and repeat-opponent
// damping — just keyed by team id. This adapts engine.ts's player-keyed rows
// and events to the team tables (migration 0010). Pure, so it's testable.

import { computeRatingUpdate, type RatingRow } from './engine.ts';

export type TeamRow = {
  id: string;
  rating: number;
  rd: number;
  volatility: number;
  matches_played: number;
  last_played_at: string | null;
};

const asRatingRow = (t: TeamRow): RatingRow => ({
  player_id: t.id,
  rating: t.rating,
  rd: t.rd,
  volatility: t.volatility,
  matches_played: t.matches_played,
  last_played_at: t.last_played_at,
});

export function computeTeamRatingUpdate(opts: {
  teamA: TeamRow;
  teamB: TeamRow;
  aWon: boolean;
  factor: number;
  now: Date;
}) {
  const update = computeRatingUpdate({
    aRow: asRatingRow(opts.teamA),
    bRow: asRatingRow(opts.teamB),
    aWon: opts.aWon,
    factor: opts.factor,
    now: opts.now,
  });
  return {
    ...update,
    // team_rating_events rows: the team ids in place of player ids, and no
    // "provisional" flag (teams are ranked from MIN matches by the app).
    events: update.events.map(
      ({ player_id, opponent_id, provisional: _provisional, ...rest }): Record<string, unknown> => ({
        team_id: player_id,
        opponent_team_id: opponent_id,
        ...rest,
      }),
    ),
    ratings: update.ratings.map(
      ({ player_id, ...rest }): Record<string, unknown> => ({ team_id: player_id, ...rest }),
    ),
  };
}
