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
   supabase functions deploy submit-tournament-match
   supabase functions deploy submit-doubles-match
   supabase functions deploy confirm-doubles-match
   ```

   Or skip the local CLI entirely: the **Deploy Supabase** GitHub workflow
   (`.github/workflows/supabase-deploy.yml`) runs the same `db push` and
   `functions deploy` on every merge that touches `supabase/`, and can be run
   by hand from the Actions tab. It needs two repository secrets
   (Settings → Secrets and variables → Actions):
   - `SUPABASE_ACCESS_TOKEN`: Supabase dashboard → Account → Access Tokens
   - `SUPABASE_DB_PASSWORD`: the project's database password (Project
     Settings → Database; resetting it there doesn't affect the app, which
     uses API keys)

3. **No function secrets to set.** The functions read `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`, which Supabase injects
   automatically into deployed Edge Functions.
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

### Admins

Only players listed in the `admins` table can create tournaments: the
Tournaments tab shows **+ New** only to them, and the `create-tournament`
function rejects everyone else. Nobody can add themselves from the app. To
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
