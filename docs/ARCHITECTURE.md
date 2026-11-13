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
`0009_admins.sql` adds `admins`, the players allowed to create tournaments
(read-only to the app; managed in the SQL Editor — see docs/DEPLOYMENT.md).
`0012_tournament_registration.sql` adds registration, pots and the kickoff
(below), `0013_tournament_kickoff_schedule.sql` the every-minute kickoff
check, and `0018_match_schedule.sql` round days and match times (below).

### Match confirmation

A **casual** match is not trusted on one player's word. `submit-match` stores it
as **`pending`** (match + games only, no rating change) via `create_pending_match`.
The **opponent** — the participant who did not submit it — then calls
`confirm-match` to **confirm** (ratings are computed *at that moment* via the shared
engine and applied by `confirm_match`) or **decline** (`reject_match` marks it
`rejected`). The repeat-opponent guard counts only `confirmed` matches. Tournament
matches are exempt: `apply_rated_match` writes them directly as `confirmed`.

The `unanswered_matches` view (`0022_unanswered_matches.sql`) counts what's
waiting on each player's answer: pending singles they're in but didn't record,
and pending doubles the other team recorded (for both opponents, until one of
them answers). The leaderboard shows it under the player's name ("⏳ 3
unanswered matches"); if the view can't be read, the board shows without it.

### Tournaments (Phase 4)

Single-elimination brackets whose matches feed the **same** rating engine as
casual play (`context = 'tournament'`). A tournament goes through:

1. **Registration** (`status = 'registration'`). An admin creates it with a
   name, format and kickoff time (`create-tournament` → `open_tournament`);
   every other player gets a notification. A trigger refuses any
   tournament whose creator isn't in `admins`, whoever inserts it. Until the
   kickoff, any player registers or withdraws (`tournament-registration` →
   `register_for_tournament` / `withdraw_from_tournament`, which hold the
   rules; until `0020_open_registration.sql` only players on the leaderboard
   could). The `tournament_live_pots` view splits the registered players into
   pots by current rating, 1500 for a player with no rated match yet (4 pots
   from 8 players, else 2; ties to whoever registered first), so every player
   sees their pot change live. The tournament page
   shows everyone the pots with the rules: how they're made, and for each pot
   the ranks and ratings it covers and what its round 1 would be if the draw
   were made now (`app/src/lib/pots.ts`, kept in step with the draw by
   `_shared/app-pots.test.ts`); it refreshes every 30 s while open.
2. **Kickoff.** At the kickoff time, `pg_cron` (`0013`) calls
   `tournament-kickoff`, deployed without the user-token check because the
   database calls it; the app also calls it when it shows a tournament past
   its kickoff, and an admin can press "Start now" (`manage-tournament`).
   `_shared/kickoff.ts` reads the pots, `_shared/draw.ts` shuffles each pot
   (Web Crypto) and seeds them in order (Pot 1 first), and the standard
   bracket (`_shared/bracket.ts`, byes to the top seeds, no size limit) then
   pairs Pot 1 with Pot 4 and Pot 2 with Pot 3 in round 1. `kickoff_tournament`
   stores the frozen pots, seeds and bracket and starts it only once, and only
   if the field didn't change during the draw (otherwise the draw is made
   again). Each player is notified of their first opponent. With fewer than
   4 players nothing happens: registration is closed and the admin moves the
   kickoff or cancels (`manage-tournament` → `reschedule_tournament` /
   `cancel_tournament`, registered players are notified).
3. **Play** (`active` → `completed`). `submit-tournament-match` records a
   ready node's result through the shared rating engine, then
   `apply_tournament_result` completes the node and advances the winner — or
   finishes the tournament on the final, which awards season points
   (`_shared/season.ts`). The rating orchestration lives in
   `_shared/engine.ts`, shared by both `submit-match` and
   `submit-tournament-match`.

**When matches are played** (`0018_match_schedule.sql`). At the draw,
`tournament_rounds` gives each round a day (one per weekday from the next
one). Triggers on `tournaments` and `tournament_matches` give every match
whose two players are known the first free slot on its round's days
(`schedule_tournament_matches`): one table, 11:00–18:00 club time, matches
never overlapping (30 minutes at best of 3, 45 at best of 5), so the draw,
each result and each walkover schedule the next matches. `match-schedule`
carries the rest, each step an RPC that checks the rules and says why it
refuses: a player proposes another time (from today until a day after the
planned day; `propose_match_time`), the opponent accepts or declines, or the
proposer takes it back (`answer_match_time`); admins move a match
(`move_tournament_match`), change a round's days (`set_round_dates`, whose
matches outside the new days are scheduled again) and give walkovers
(`give_walkover`: the winner advances, nothing rated). Players hear about
every new or moved time (`announceSchedules` in `_shared/schedule.ts`, sent
once each through `schedule_announced`). A match still not played the day
after its date is overdue (`is_overdue`): the every-minute job then calls
`tournament-kickoff`, which tells every admin once (`announceOverdue`). The
app shows the times and round days on the bracket, the proposal flow on the
player's match card, and the organizer's tools (`components/MatchSheets.tsx`),
with the times picked from `lib/schedule.ts` (the same rules, in club time
whatever the phone's zone).

Tournaments from before registration existed have no kickoff time or pots
and show as before. The app only reads the tournament tables; every change is
an RPC called by an Edge Function with the service role.

### Doubles (2v2)

Ranked by **team**: `0010_doubles.sql` adds `teams` (one row per pair of
players, created on first use by `team_for_pair`, with its own Glicko-2 rating),
`doubles_matches` + `doubles_games`, and `team_rating_events`. The flow mirrors
casual singles: `submit-doubles-match` stores the match as `pending`
(`create_pending_doubles_match`), then **either opponent** calls
`confirm-doubles-match` to confirm (`confirm_doubles_match` applies both teams'
updates, computed by `_shared/doubles.ts` through the same engine) or decline
(`reject_doubles_match`). The repeat guard counts confirmed matches between the
same two teams in the last 24 h. See docs/RATING.md §5.

### Tiers

Players on the leaderboard have a tier from their skill rating: Bronze,
Silver, Gold, Platinum, Diamond (`0014_tiers.sql`). The lines are in
`tier_lines`; a trigger on `player_ratings` keeps `player_tiers` up to date
whatever changed the rating: up as soon as a line is reached, down only 25
points under the tier's line (so one match near a line doesn't flip it), and
records every move in `tier_changes`. After a rated result, `confirm-match`
and `submit-tournament-match` call `announceRewards` (`_shared/rewards.ts`),
which pushes promotions ("Promoted to Gold"). The app reads everyone's tier
from the `player_badges` view (one row per player, plus Legend for #1 on the
leaderboard and "inactive" after 30 days without a match) through
`BadgesContext`, and draws it as a ring around avatars (`Avatar` with a
`playerId`), a label on the leaderboard and a tier card with the way to the
next line on profiles. `TierCelebration` shows "Promoted to Gold" once per
device when the player's tier went up since they last saw it.

### Titles and trophies

`0015_titles.sql` adds achievements (the `achievements` catalog: Regular,
Iron Paddle, Social Butterfly, Giant Slayer, Comeback Kid, Bagel Baker, Deuce
Master, On Fire, Doubles Dynamo, Finalist, Champion; `0016_more_titles.sql`
adds Lunch Break Legend, Night Owl, Touch Grass, Coin Flip, Dark Horse, Seed
Killer, Ride or Die and Partner Hopper, with times of day in
`club_time_zone()`; `0017_title_tweaks.sql` sets Giant Slayer's gap to 300 in
`giant_slayer_gap()` and renames Seed Killer to Beast Killer;
`0019_unkillable_demon_king.sql` adds Unkillable Demon King, a tournament won
without losing a game; `0023_giant_slayer_min_matches.sql` counts a Giant
Slayer win only over an opponent with 10 rated matches already played, set in
`giant_slayer_min_matches()`; `0024_farmer.sql` adds Farmer, 10+ singles
matches against the same player with at least 80% won, set in
`farmer_min_matches()` and `farmer_min_percent()`). Views work them out from
the match history, so older matches count and nothing can be faked:
`achievement_progress` (progress and when each was first completed),
`tournament_honours` (who played each completed final) and `earned_titles`
(every title a player can show: an achievement, or "Champion · <tournament>"
per tournament won). A player picks one with `players.title`; a trigger
refuses a title that isn't earned, and `player_badges` only shows it while it
still is. `player_badges` also gives the number of tournaments won (a gold
laurel around the avatar) and the season-points leader (a crown).
`announceRewards` pushes new titles once each (`achievement_notices`; titles
earned before 0015 count as announced), after singles, tournament and doubles
results. In the app: the title next to names on the leaderboard and under them
on profiles, a cabinet on profiles (`TrophyCabinet`) with two tabs — Titles
(progress toward each, and on your own profile the title to show) and Trophies
(every podium, and the crown) — and `TitleCelebration` ("2 new titles") once
per device, never in the same visit as another popup.

**Trophy and medals.** `0021_tournament_podium.sql` adds `tournament_podium`:
each completed tournament's champion (1), runner-up (2) and both semifinal
losers (3; there's no third-place match). The app draws the champion's trophy
and the silver and bronze medals (`components/TournamentArt.tsx`, SVG in a
cartoon style, lettered with the tournament's name and year in Lilita One,
bundled through `@expo-google-fonts/lilita-one`). They show from the start:
until a tournament is over, its page opens with what's up for grabs (the
trophy between the two medals) and its row in the Tournaments list carries the
trophy. Once it's over, the page shows the champion with the trophy, then the
podium; the list row, who won it and when; and each player's Trophies tab,
what they won.

### Push notifications

Players switch notifications on per device in Profile, or from the
"Turn on notifications?" popup (`components/PushPromptSheet.tsx`) that a
signed-in player with them off sees a few seconds after opening the app ("Not
now" hides it for 3 days; never in a visit where the install popup shows).
That's web only (the browser or the installed app); on iPhone/iPad only the
Home Screen app can get them, iOS 16.4+. `app/src/lib/push.ts` asks for permission and subscribes
through the service worker (`app/public/sw.js`, which shows each notification
and opens the app on its page when tapped); the `push-subscription` Edge
Function stores the device in `push_subscriptions`
(`0011_push_notifications.sql`, invisible to the app). Signing out turns them
off on that device. `submit-match`, `confirm-match`, `submit-doubles-match`
and `confirm-doubles-match` then notify the players involved
(`_shared/notify.ts`, texts in `_shared/messages.ts`): a match to confirm, or
a match they recorded confirmed (with the rating change) or declined. The
tournament functions notify too: a new tournament open for registration, the
draw (each player's first opponent and when), a moved kickoff, a
cancellation, each match's time (and any change), a proposed time to answer
or a declined one, a walkover, and admins a match not played on its day. Sending
is standard Web Push (`_shared/webpush.ts`: RFC 8291 encryption and VAPID,
Web Crypto only), signed with a key pair the server creates on first use and
keeps in `push_keys`. A subscription the push service reports as gone is
deleted.

## Security model (Row-Level Security)

- Any **authenticated** user can **read** `players` and `player_ratings`
  (needed for leaderboards and profiles).
- A user can **update only their own** `players` row (profile).
- **No client policy** allows writing `player_ratings` — only the Edge Function,
  running as the service role, updates ratings. This is what makes ratings
  non-cheatable.

## App structure (`/app/src`)

```
lib/env.ts          SUPABASE_URL/ANON_KEY + the DEMO flag (true when either is unset)
lib/supabase.ts     Configured Supabase client (session persisted via AsyncStorage)
lib/demo.ts         In-memory demo backend (sample players/matches/tournament)
lib/commentary.ts   Hype play-by-play line pools + pickers (match result, champion,
                    home tip, streaks) — pure, no I/O
lib/avatar.ts       Uploads a picked photo to the `avatars` Storage bucket and
                    writes its public URL to players.avatar_url
lib/                players, matches, leaderboard, tournaments data-access helpers
lib/schedule.ts     Tournament match times in club time (Bucharest): the hours, slots
                    and the times a player or admin can pick (the database's rules)
context/AuthContext Session state + sign-in / sign-up / sign-out / password-reset helpers;
                    signs in from email links (lib/authLink.ts reads them from the URL)
navigation/         Root switch (auth vs app), bottom tabs, and per-tab stacks
screens/            SignIn, Home, SubmitMatch, Leaderboard, PlayerProfile,
                    Tournaments, Profile
components/          RatingChart (react-native-svg), Avatar, Placeholder
theme.ts            Shared colors / spacing
```

### Demo mode

Every data function in `lib/*.ts` starts with `if (DEMO) return demo.xyz(...)`.
When `app/.env` has no Supabase URL/key, `DEMO` is `true`: `AuthContext` seeds a
stand-in signed-in session and all reads/writes hit `lib/demo.ts`'s in-memory
store instead of the network — so the whole app (auth, matches, confirmation,
leaderboard, profiles, tournaments) is explorable and clickable with **zero
backend setup**. Setting real Supabase env vars turns this off automatically;
production behavior is unaffected since `DEMO` can only be true when
configuration is missing.

Navigation shows the sign-in screen when there is no session, and the tab
navigator (Home · Leaderboard · Tournaments · Profile) once signed in. The Home,
Leaderboard, and Profile tabs are stacks so they can push the Submit-match and
Player-profile screens.

### Commentary

`lib/commentary.ts` picks a hype play-by-play line from a small pool based on
real match context — score margin, a rating-delta "upset" threshold
(`UPSET_DELTA_THRESHOLD`), or a win/loss streak length — never generic filler.
It's wired into: the match-confirmation alert on Home (using the actual rating
delta from `confirm-match`'s response), the tournament champion banner, Home's
rotating tip card, and small profile flourishes (a streak banner, an "UPSET"
tag on big-swing matches) and leaderboard medals (🥇🥈🥉 for the top 3). To
support the confirm-flow line, `confirm-match`'s response gained a
caller-relative `you: { delta, rating, rd }` field (and `demoConfirm` mirrors
it) alongside the existing `status`/`repeatFactor`.

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
