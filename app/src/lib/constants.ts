// Shared app constants. Mirrors the rating rules documented in docs/RATING.md.

// A player must have played (and had confirmed by their opponent) at least
// this many matches to appear on the public leaderboard. It's also the only
// "new player" number the app shows: the first this-many matches move a rating
// the most. The rating engine's PROVISIONAL_MATCHES (glicko2.ts) matches it.
export const MIN_MATCHES_FOR_LEADERBOARD = 3;
