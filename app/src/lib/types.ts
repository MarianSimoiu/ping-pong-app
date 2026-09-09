// Hand-written types for the Phase 1 schema. Once the schema settles these can
// be replaced with generated types (`supabase gen types typescript`).

export type Player = {
  id: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
};

export type PlayerRating = {
  player_id: string;
  rating: number;
  rd: number;
  volatility: number;
  matches_played: number;
  last_played_at: string | null;
  updated_at: string;
};

// A player joined with their current rating, as shown on profiles / leaderboard.
export type PlayerWithRating = Player & { rating: PlayerRating | null };

export type Match = {
  id: string;
  context: 'casual' | 'tournament';
  tournament_id: string | null;
  round: number | null;
  player_a: string;
  player_b: string;
  winner_id: string;
  best_of: number;
  played_at: string;
  created_by: string;
  created_at: string;
};

export type MatchGame = {
  id: string;
  match_id: string;
  game_no: number;
  score_a: number;
  score_b: number;
};

export type RatingEvent = {
  id: string;
  match_id: string;
  player_id: string;
  opponent_id: string;
  result: 'win' | 'loss';
  rating_before: number;
  rating_after: number;
  rd_before: number;
  rd_after: number;
  volatility_before: number;
  volatility_after: number;
  delta: number;
  repeat_factor: number;
  provisional: boolean;
  created_at: string;
};

// Minimal shape used by the opponent picker.
export type OpponentOption = { id: string; display_name: string };

// What the submit-match Edge Function returns.
export type SubmitMatchResult = {
  matchId: string;
  repeatFactor: number;
  you: { before: { rating: number; rd: number }; after: { rating: number; rd: number } };
  opponent: { before: { rating: number; rd: number }; after: { rating: number; rd: number } };
};
