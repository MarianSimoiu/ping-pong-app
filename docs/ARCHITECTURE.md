# Architecture

This document describes the technical design of the ping-pong tracker. For the
rating math specifically, see [`RATING.md`](RATING.md).

## Goals

- A **fluid phone app** to track players, 1v1 matches, and tournaments.
- A **fair rating system** that rewards good players on performance and cannot be
  farmed by playing many easy games.
- Cheap to run (free tier) and simple to operate (no self-managed servers).

## High-level shape

```
┌─────────────────────────┐        ┌──────────────────────────────────┐
│  Expo app (React Native)│ HTTPS  │           Supabase               │
│  runs on the phone      │ ─────► │  Postgres · Auth · Storage       │
│  - screens / UI         │ ◄───── │  Edge Functions (rating engine)  │
│  - @supabase/supabase-js│realtime│                                  │
└─────────────────────────┘        └──────────────────────────────────┘
```

- **Client** (`/app`): Expo + TypeScript. Talks to Supabase directly via
  `@supabase/supabase-js`. Distributed via Expo Go (dev), EAS Build (APK / store).
- **Backend** (`/supabase`): a managed Supabase project. No server to maintain.
  - **Postgres** holds all data.
  - **Auth** handles sign-up / sign-in.
  - **Edge Functions** run the rating engine server-side.
- **Rating engine**: pure functions in `supabase/functions/_shared` (unit-tested)
  invoked by the `submit-match` Edge Function. Clients **never** compute or write
  ratings — enforced by Row-Level Security.

## Why these choices

- **Expo / React Native** — one TypeScript codebase for iOS + Android with a
  native feel; instant preview via Expo Go; store-ready via EAS with no rewrite.
- **Supabase** — the data is relational (players ↔ matches ↔ tournaments ↔ rating
  history), which Postgres models cleanly; plus hosted Auth + realtime + free tier.
- **Server-side ratings** — if the phone computed ratings, a user could fake them.
  Running the engine in an Edge Function (writing with the service role) makes the
  numbers authoritative.

## Data model

The schema is built up across migrations in `supabase/migrations`. Phase 1
(`0001_foundation.sql`) introduces:

- **`players`** — `id`, `user_id` (→ `auth.users`), `display_name`, `avatar_url`,
  `created_at`. One row per authenticated user, auto-created on sign-up by the
  `handle_new_user` trigger.
- **`player_ratings`** — current skill snapshot: `player_id`, `rating` (1500),
  `rd` (350), `volatility` (0.06), `matches_played`, `last_played_at`,
  `updated_at`.

Phase 2 (`0002_matches.sql`) adds `matches`, `match_games`, `rating_events`
(append-only audit), and the `apply_rated_match` RPC that persists a rated match
atomically. Phase 4 (`0003_tournaments.sql`) adds `tournaments`,
`tournament_participants`, `tournament_matches` (one row per bracket node), plus
`create_tournament` and `apply_tournament_result` RPCs. Phase 5
(`0004_season_points.sql`) adds `season_points` plus the `award_season_points`
RPC and the `season_standings(best_n)` ranking function. `0005_match_confirmation.sql`
adds a `status` column to `matches` and the confirmation RPCs (below).

### Match confirmation

A **casual** match is not trusted on one player's word. `submit-match` stores it
as **`pending`** (match + games only, no rating change) via `create_pending_match`.
The **opponent** — the participant who did not submit it — then calls
`confirm-match` to **confirm** (ratings are computed *at that moment* via the shared
engine and applied by `confirm_match`) or **decline** (`reject_match` marks it
`rejected`). The repeat-opponent guard counts only `confirmed` matches. Tournament
matches are exempt: `apply_rated_match` writes them directly as `confirmed`.

### Tournaments (Phase 4)

Single-elimination brackets whose matches feed the **same** rating engine as
casual play (`context = 'tournament'`). Bracket generation is pure, tested TS
(`_shared/bracket.ts`); byes auto-advance top seeds. Two Edge Functions:
`create-tournament` (generates the bracket, persists it via `create_tournament`)
and `submit-tournament-match` (records a ready node's result through the shared
rating engine, then `apply_tournament_result` completes the node and advances the
winner — or finishes the tournament on the final). The rating orchestration lives
in `_shared/engine.ts`, shared by both `submit-match` and
`submit-tournament-match`.

## Security model (Row-Level Security)

- Any **authenticated** user can **read** `players` and `player_ratings`
  (needed for leaderboards and profiles).
- A user can **update only their own** `players` row (profile).
- **No client policy** allows writing `player_ratings` — only the Edge Function,
  running as the service role, updates ratings. This is what makes ratings
  non-cheatable.

## App structure (`/app/src`)

```
lib/supabase.ts     Configured Supabase client (session persisted via AsyncStorage)
lib/                players, matches, leaderboard data-access helpers + constants
context/AuthContext Session state + sign-in / sign-up / sign-out helpers
navigation/         Root switch (auth vs app), bottom tabs, and per-tab stacks
screens/            SignIn, Home, SubmitMatch, Leaderboard, PlayerProfile,
                    Tournaments, Profile
components/          RatingChart (react-native-svg), Placeholder
theme.ts            Shared colors / spacing
```

Navigation shows the sign-in screen when there is no session, and the tab
navigator (Home · Leaderboard · Tournaments · Profile) once signed in. The Home,
Leaderboard, and Profile tabs are stacks so they can push the Submit-match and
Player-profile screens.

## Build phases

1. **Foundation** *(this phase)* — Expo scaffold + navigation, Supabase client,
   `players`/`player_ratings` + auth, this document.
2. **Matches + rating engine** — match schema, `rating_events`, pure `glicko2.ts`
   + tests, `submit-match` Edge Function, submit-match screen, `RATING.md`.
3. **Leaderboard & profiles** *(done)* — ranking query (min-matches gate),
   player profiles with W–L record, match history, and a rating-over-time chart.
4. **Tournaments** *(done)* — single-elim schema, rating-seeded brackets with
   byes, bracket UI, and tournament matches feeding the shared rating engine.
5. **Season points (WTA layer)** *(done)* — `season_points`, tier-weighted
   placement points on a rolling 52-week best-N window, awarded when a tournament
   completes; Season-points leaderboard tab and profile stat.
6. **Ship** — EAS build, share APK, RLS review, optional OTA updates.
