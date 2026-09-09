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
atomically. Later phases add: `tournaments`, `tournament_participants`, `seasons`,
`season_points`.

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
4. **Tournaments** — tournament schema, seeding, brackets, tournament matches.
5. **Season points + anti-farming polish** — `seasons`/`season_points`, points on
   placement, finalize the four anti-farming guards.
6. **Ship** — EAS build, share APK, RLS review, optional OTA updates.
