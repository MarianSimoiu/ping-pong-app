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
supabase db reset     # applies every migration in supabase/migrations (0001–0004)
supabase functions serve   # serves the Edge Functions locally
```

`supabase start` prints an **API URL** and **anon key** — use those in `app/.env`.

### Option B — hosted project (for real users)

1. Create a project at https://supabase.com (note the project ref).
2. Link and push the schema + functions:

   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push                       # applies migrations 0001–0004
   supabase functions deploy submit-match
   supabase functions deploy create-tournament
   supabase functions deploy submit-tournament-match
   ```

3. **No function secrets to set.** The functions read `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`, which Supabase injects
   automatically into deployed Edge Functions.
4. Grab the project's **API URL** and **anon key** from Project Settings → API for
   the app's `.env`. Never put the **service role** key in the app.

### Migrations in this repo

| File | Adds |
|---|---|
| `0001_foundation.sql` | `players`, `player_ratings`, sign-up trigger, RLS |
| `0002_matches.sql` | `matches`, `match_games`, `rating_events`, `apply_rated_match` |
| `0003_tournaments.sql` | tournaments + bracket tables, `create_tournament`, `apply_tournament_result` |
| `0004_season_points.sql` | `season_points`, `award_season_points`, `season_standings` |

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
  their own profile**. Ratings, matches, tournaments, and season points have **no
  client write policy** — they change only via the server-side functions/RPCs.
- Keep the service-role key server-side only. It must never appear in `app/` or in
  any `EXPO_PUBLIC_*` variable.
