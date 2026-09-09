# Supabase backend

Hosted Postgres + Auth + Storage + Edge Functions. This is the only always-on
part of the stack.

## Local development

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
# from the repo root
supabase start        # boots local Postgres, Auth, Studio (prints URL + anon key)
supabase db reset     # drops and re-applies every migration in ./migrations
supabase stop         # shut it down
```

`supabase start` prints an **API URL** and **anon key** — copy those into
`app/.env` (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`) to run
the app against your local backend.

## Migrations

- `migrations/0001_foundation.sql` — `players`, `player_ratings`, sign-up
  trigger, and RLS.

Add new schema as further numbered migrations (`0002_...`, `0003_...`). Apply
them locally with `supabase db reset`, then push to a hosted project with
`supabase db push`.

## Edge Functions

Added in a later phase: `functions/rate-match` (the rating engine) with pure,
unit-tested math in `functions/_shared`. Ratings are written here using the
service role so clients can never modify them.
