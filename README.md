# ping-pong-app

A phone app to track ping-pong **players, 1v1 matches, and tournaments**, with a
**fair rating system** that rewards good players on performance.

## Ratings at a glance

Every player has **two numbers**:

1. **Skill rating (Glicko-2)** — updated after every match. Answers *"how good
   are you right now?"* Beating weak opponents barely moves it; losing to them
   costs a lot, so it can't be farmed.
2. **Season points (WTA-style)** — earned by placing in tournaments, weighted by
   tournament tier, on a rolling 52-week best-N window that decays over time.
   Answers *"what have you achieved lately?"*

The full math and every anti-farming rule are documented in
[`docs/RATING.md`](docs/RATING.md) so any number can be verified.

## Stack

| Layer | Choice |
|---|---|
| App | **Expo (React Native) + TypeScript** |
| Backend | **Supabase** (hosted Postgres + Auth + Storage + Edge Functions) |
| Rating engine | Runs **server-side** in a Supabase Edge Function — authoritative, not cheatable |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design.

## Repository layout

```
/app             Expo React Native app (TypeScript)
/supabase        Database migrations + Edge Functions (rating engine)
/docs            Architecture and rating-math documentation
/.devcontainer   GitHub Codespaces config (zero local install)
```

## See it running — no local install needed

The app has a built-in **demo mode**: if no Supabase backend is configured, it
boots with sample players, matches, and a tournament already loaded, so you can
see and click through every screen immediately.

**Fastest path — GitHub Codespaces (everything runs in your browser):**

1. On this repo's GitHub page, click **`< > Code`** → **Codespaces** tab →
   **Create codespace on main**. Wait ~1 minute for VS Code to open in your browser.
2. In its terminal: `cd app && npm install && npm run web`
3. A "port forwarded" popup appears — click **Open in Browser**.

You're now looking at the real app (demo data, no backend). **Edit any file
under `app/src` and save** — the page hot-reloads with your change. That's the
whole develop-and-debug loop: no local Node, no Git, no Supabase account.

## Connecting a real backend

Demo mode is for UI work. To persist real players/matches/ratings, wire up
Supabase:

```bash
# Install the Supabase CLI, then from the repo root:
supabase start                 # spins up local Postgres + Auth + Studio
supabase db reset              # applies everything in supabase/migrations
```

```bash
cd app
cp .env.example .env           # fill in your Supabase URL + anon key
npm install
npx expo start                 # scan the QR code with Expo Go
```

Local Supabase prints its URL and anon key on `supabase start`; use those in
`app/.env`. Once `app/.env` has real values, demo mode turns itself off
automatically and the app talks to that backend instead.

For hosted setup, EAS builds, and shipping, see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
