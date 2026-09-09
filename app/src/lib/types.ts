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
