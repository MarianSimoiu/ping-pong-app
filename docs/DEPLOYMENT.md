# Deployment

End-to-end setup for the ping-pong tracker: the Supabase backend, local
development, and building/shipping the Expo app. Everything here uses free tiers
to start.

## Prerequisites

- **Node.js** 18+ and **npm**
- **Supabase CLI** — https://supabase.com/docs/guides/cli (`brew install supabase/tap/supabase` or npm)
- **Deno** (optional, to run the rating-engine tests) — https://deno.com
- Accounts (free): **Supabase**, and for app builds **Expo** (EAS). App-store
  publishing later needs Google Play ($25 once) and/or Apple ($99/yr).

---

## 1. Backend (Supabase)

### Option A — local (fastest for development)

From the repo root:

```bash
supabase start        # boots local Postgres, Auth, Studio; prints API URL + anon key
supabase db reset     # applies every migration in supabase/migrations
supabase functions serve   # serves the Edge Functions locally
```

`supabase start` prints an **API URL** and **anon key** — use those in `app/.env`.

### Option B — hosted project (for real users)

1. Create a project at https://supabase.com (note the project ref).
2. Link and push the schema + functions:

   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push                       # applies any migrations not yet applied
   supabase functions deploy submit-match
   supabase functions deploy confirm-match
   supabase functions deploy create-tournament
   supabase functions deploy tournament-registration
   supabase functions deploy manage-tournament
   supabase functions deploy tournament-kickoff --no-verify-jwt
   supabase functions deploy submit-tournament-match
   supabase functions deploy match-schedule
   supabase functions deploy submit-doubles-match
   supabase functions deploy confirm-doubles-match
   supabase functions deploy push-subscription
   ```

   Or skip the local CLI entirely: the **Deploy Supabase** GitHub workflow
   (`.github/workflows/supabase-deploy.yml`) runs the same `db push` and
   `functions deploy` (then `tournament-kickoff` again with `--no-verify-jwt`,
   since the database calls it without a user's token) on every merge that
   touches `supabase/`, and can be run
   by hand from the Actions tab. It needs two repository secrets
   (Settings → Secrets and variables → Actions):
   - `SUPABASE_ACCESS_TOKEN`: Supabase dashboard → Account → Access Tokens
   - `SUPABASE_DB_PASSWORD`: the project's database password (Project
     Settings → Database; resetting it there doesn't affect the app, which
     uses API keys)

3. **No function secrets to set.** The functions read `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`, which Supabase injects
   automatically into deployed Edge Functions. Push notifications need no
   setup either: the server creates its own signing keys (in `push_keys`) the
   first time someone turns notifications on.
4. Grab the project's **API URL** and **anon key** from Project Settings → API for
   the app's `.env`. Never put the **service role** key in the app.

### Troubleshooting: confirmation link shows "can't reach this page" / "localhost refused to connect"

This is a **Supabase dashboard setting**, not an app bug. Supabase sends
users to **Authentication → URL Configuration → Site URL** after confirming
their email — by default that's `http://localhost:3000`, which only works if
you happen to be running something there yourself. The confirmation itself
already succeeded (Supabase marks the email confirmed *before* that final
redirect) — the browser error is just a dead-end redirect. **The fix: go back
to the app and sign in normally**, it'll work.

To stop this from happening to every new user, set **Site URL** to wherever
the app is actually reachable:
- Deployed to Vercel (see Option C below)? Use that `https://....vercel.app` URL.
- Only testing in a Codespace dev server? There's no stable URL to set — the
  error is harmless and expected; deploying to Vercel is the real fix.

With the Site URL set, a confirmation link opens the app already signed in.
**Password-reset links** ("Forgot password?" on the sign-in screen) depend on
it too: the app asks Supabase to send people back to its own address, which
must be the Site URL or listed under **Redirect URLs** on the same page.
Otherwise the link lands on the wrong page and the reset can't finish.

### Migrations in this repo

| File | Adds |
|---|---|
| `0001_foundation.sql` | `players`, `player_ratings`, sign-up trigger, RLS |
| `0002_matches.sql` | `matches`, `match_games`, `rating_events`, `apply_rated_match` |
| `0003_tournaments.sql` | tournaments + bracket tables, `create_tournament`, `apply_tournament_result` |
| `0004_season_points.sql` | `season_points`, `award_season_points`, `season_standings` |
| `0005_match_confirmation.sql` | `matches.status`, `create_pending_match`, `confirm_match`, `reject_match` |
| `0006_avatar_storage.sql` | public `avatars` Storage bucket, upload limited to your own folder |
| `0007_freeform_casual_matches.sql` | casual matches record however many games were played |
| `0008_player_records.sql` | `player_records` view (win/loss counted in the database) |
| `0009_admins.sql` | `admins` (who can create tournaments) |
| `0010_doubles.sql` | 2v2: `teams` (one per pair, with its own rating), `doubles_matches`, `doubles_games`, `team_rating_events`, `team_records`, and the pending/confirm/decline RPCs |
| `0011_push_notifications.sql` | `push_subscriptions` (one per device with notifications on) and `push_keys` (the server's own key pair), both invisible to the app |
| `0012_tournament_registration.sql` | registration until a kickoff time (`tournaments.kickoff_at`, statuses `registration`/`cancelled`), pots (`tournament_live_pots` view; frozen `pot`/`seed`/`rating_at_draw` on participants), the register/withdraw/kickoff/reschedule/cancel RPCs, and a trigger that refuses any tournament not created by an admin |
| `0013_tournament_kickoff_schedule.sql` | every minute, `pg_cron` checks for a tournament due to start and calls `tournament-kickoff` through `pg_net` (see below) |
| `0014_tiers.sql` | tiers (Bronze to Diamond) from the skill rating: `tier_lines` (set from the ratings when it ran), `player_tiers` kept up to date by a trigger, `tier_changes` (used to announce promotions), and the `player_badges` view the app reads for avatar rings (with Legend and inactive) |
| `0015_titles.sql` | titles and trophies: the `achievements` catalog, the `achievement_progress`, `tournament_honours` and `earned_titles` views (worked out from match history), `players.title` (only an earned title can be set), `achievement_notices` (each unlock is pushed once), and `player_badges` gains the champion count, the season-points leader and the shown title |
| `0016_more_titles.sql` | eight more titles (Lunch Break Legend, Night Owl, Touch Grass, Coin Flip, Dark Horse, Seed Killer, Ride or Die, Partner Hopper) in the catalog and `achievement_progress`, and `club_time_zone()` (see below). Not marked as announced: players who already qualify hear about it with their next match |
| `0017_title_tweaks.sql` | Giant Slayer takes a 300+ point gap (`giant_slayer_gap()`; was 150): a shown Giant Slayer earned from a smaller gap is cleared, and announced again when earned for real. Seed Killer is renamed Beast Killer 🐉 |
| `0018_match_schedule.sql` | when tournament matches are played (see below): `tournament_rounds` (each round's days), match times on `tournament_matches` (`scheduled_at`, `planned_on`, a pending `proposed_at`/`proposed_by`, `walkover`), automatic times on the one table, the propose/answer/move/round-dates/walkover RPCs, and the every-minute job also reports matches not played on their day. Tournaments already in progress get their dates and times when it runs. Walkovers don't count for Dark Horse or Beast Killer |
| `0019_unkillable_demon_king.sql` | the Unkillable Demon King 👹 title: win a tournament without losing a single game (walkovers count neither way; at least one match played). Tournaments already played count; not marked as announced, so a player who already qualifies hears about it with their next match |
| `0020_open_registration.sql` | anyone can register for a tournament (no more 3-match rule); in the pots and the draw, a player with no rated match yet counts as 1500 |
| `0021_tournament_podium.sql` | the `tournament_podium` view: each completed tournament's champion, runner-up and both semifinal losers, for the trophy and the silver and bronze medals the app shows. Tournaments already played count |
| `0022_unanswered_matches.sql` | the `unanswered_matches` view: how many pending matches wait on each player to confirm or decline (singles they didn't record; doubles the other team recorded, for both opponents), shown on the leaderboard |
| `0023_giant_slayer_min_matches.sql` | Giant Slayer counts only a win over someone who had already played 10 rated singles matches (`giant_slayer_min_matches()`). Whoever had it only from beating newcomers loses it: cleared from under their name, and announced again when earned for real |
| `0024_farmer.sql` | the Farmer 🌾 title: play 10+ rated singles matches against the same player and win at least 80% of them (`farmer_min_matches()`, `farmer_min_percent()`). Matches already played count; not marked as announced, so a player who already qualifies hears about it with their next match |

### Club time zone

The time-of-day titles (Lunch Break Legend: 12:00–14:00, Night Owl: from
20:00, Touch Grass: one day) and tournament match times read the time in
`club_time_zone()`, `Europe/Bucharest`. For another zone, run in the SQL
Editor (and change `CLUB_TIME_ZONE` in `app/src/lib/schedule.ts` and
`supabase/functions/_shared/rounds.ts` to match):

```sql
create or replace function public.club_time_zone() returns text
language sql immutable as $$ select 'Europe/London'::text $$;
```

### Tournament match times

From `0018`, tournament matches have times, on one table, between 11:00 and
18:00 club time (`club_opens()`, `club_closes()`), never overlapping: a match
takes 30 minutes at best of 3, 45 at best of 5 (`match_slot()`).

- **Round days.** At the draw each round gets a day: one round per weekday,
  starting the weekday after the draw. An admin changes a round's days on the
  tournament page (Edit next to the round); its matches outside the new days
  get new times in them.
- **Match times.** As soon as both players of a match are known (the draw, a
  result, a walkover), it gets the first free slot on its round's days, and
  both players are notified.
- **Players** can propose another time: 11:00 to 18:00, from today up to one
  day after the day it was set for. The opponent accepts (the match moves) or
  keeps the time; until then it stays as it was.
- **Admins** can move any match waiting to be played (the app offers the next
  3 weeks, 11:00 to 18:00; the database takes any future time), or give a
  walkover (one player goes through; no match recorded, no rating change).
- **Not played on its day:** the day after, the match shows as overdue and
  every admin gets a notification (once): record the result, move it, or give
  a walkover.

The same every-minute job as the kickoff (below) checks for overdue matches,
so nothing else needs setting up. To change the hours, replace
`club_opens()`/`club_closes()` the same way as `club_time_zone()` above (and
`CLUB_OPENS`/`CLUB_CLOSES` in `app/src/lib/schedule.ts`).

### Admins

Only players listed in the `admins` table can create tournaments: the
Tournaments tab shows **+ New** only to them, the `create-tournament`
function rejects everyone else, and since `0012` the database itself refuses
a tournament whose creator isn't an admin, however it's inserted (even from
the SQL Editor). Admins also start, move and cancel tournaments
(`manage-tournament`), and set round days, move matches and give walkovers
(`match-schedule`). Nobody can add themselves from the app. To
make someone an admin, run this in the Supabase **SQL Editor** with the email
they sign in with:

```sql
insert into public.admins (player_id)
select p.id from public.players p
join auth.users u on u.id = p.user_id
where u.email = 'their-sign-in@email.com';
```

To remove an admin, delete their row the same way:
`delete from public.admins where player_id = (select p.id from public.players p join auth.users u on u.id = p.user_id where u.email = 'their-sign-in@email.com');`

### Tier lines

The tiers' rating lines were set from the players' ratings when `0014` ran
(about 20% Bronze, 30% Silver, 25% Gold, 15% Platinum, 10% Diamond). To see or
move them, in the SQL Editor:

```sql
select * from public.tier_lines order by min_rating;
update public.tier_lines set min_rating = 1650 where tier = 'diamond';
select public.refresh_player_tiers();  -- re-tier everyone from the new lines
```

### Tournament kickoff

A tournament starts at its kickoff time on its own: `0013` turns on Supabase's
`pg_cron` and `pg_net` extensions and schedules a check every minute that
calls the `tournament-kickoff` function when a tournament is due with at least
4 players (the function makes the draw and notifies everyone). The app also
asks for the draw when someone has the tournament open at kickoff. If the
migration couldn't turn the extensions on, it only warns ("Tournaments won't
start on their own…"): turn on **pg_cron** and **pg_net** under Database →
Extensions, then run the `do $$ … $$;` block at the end of
`0013_tournament_kickoff_schedule.sql` in the SQL Editor. To check it's
scheduled: `select jobname, schedule from cron.job;` should list
`tournament-kickoff`.

---

## 2. App (Expo)

```bash
cd app
cp .env.example .env      # fill EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
npm install
npm run typecheck         # optional: TypeScript check
npx expo start            # scan the QR code with the Expo Go app
```

The app talks to whichever Supabase you pointed `.env` at (local or hosted).

### Option C — Web (free, reaches every device — no install)

The app already runs on the web (`react-native-web`); this turns it into a
shareable link instead of a dev-server QR code.

```bash
cd app
npm run build:web     # optional local sanity check -> app/dist
```

To deploy it for real:

1. Create a free account at https://vercel.com and connect your GitHub.
2. "Add New… → Project" → import this repo. The repo's `vercel.json` already
   pins the build command and output directory, so no manual build settings
   are needed.
3. In the Vercel project's **Environment Variables**, add
   `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (same values
   as `app/.env`, pointed at your hosted Supabase project).
4. Deploy. You get a free URL like `https://<your-project>.vercel.app` —
   share that link with anyone, any device, no install. Every push to `main`
   auto-redeploys it.
5. In the Supabase dashboard: **Authentication → URL Configuration**, set
   **Site URL** to that same Vercel URL, so email-confirmation links land back
   on the live app.

This is additive — the Android APK path below still works for anyone who
wants an installed app icon.

---

## 3. Tests

The rating and bracket logic is pure and unit-tested:

```bash
deno test supabase/functions/_shared
```

This runs the Glicko-2, match-resolution, bracket, and season-points tests,
including Glickman's canonical worked example and the numbers in
[`RATING.md`](RATING.md).

---

## 4. Building & shipping the app (EAS)

```bash
cd app
npm install -g eas-cli    # if not already installed
eas login

# Android APK you can share with friends directly (no store):
eas build --platform android --profile preview

# Production builds for the stores:
eas build --platform android --profile production
eas build --platform ios --profile production   # needs an Apple Developer account
```

- The **preview** profile (see `app/eas.json`) produces an installable **APK** —
  send the link, friends install it. Best for a club.
- `eas submit --platform android|ios` uploads to the stores when you're ready.
- After a store release, ship JS-only updates over the air:

  ```bash
  eas update --branch production
  ```

Set the app's Supabase env for builds via EAS environment variables (or an
`.env` picked up at build time); use the hosted project's URL + anon key.

---

## Security notes

- All rating and tournament writes go through Edge Functions using the **service
  role**; clients only ever hold the **anon** key.
- Every data table has RLS: authenticated users can **read**, and can **write only
  their own profile**. Ratings, matches, tournaments, season points, and admins
  have **no client write policy** — they change only via the server-side
  functions/RPCs (or, for admins, the SQL Editor).
- Keep the service-role key server-side only. It must never appear in `app/` or in
  any `EXPO_PUBLIC_*` variable.
