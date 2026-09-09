-- 0001_foundation.sql
-- Phase 1 foundation: players + current skill-rating snapshot,
-- auto-provisioning on sign-up, and Row-Level Security.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.players (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null unique references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

-- Current skill-rating snapshot (Glicko-2). History lives in a later migration
-- (rating_events). Defaults are the standard Glicko-2 starting values.
create table public.player_ratings (
  player_id       uuid primary key references public.players (id) on delete cascade,
  rating          double precision not null default 1500,
  rd              double precision not null default 350,
  volatility      double precision not null default 0.06,
  matches_played  integer not null default 0,
  last_played_at  timestamptz,
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Auto-provision a player + rating row when a new auth user is created.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_player_id uuid;
begin
  insert into public.players (user_id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  returning id into new_player_id;

  insert into public.player_ratings (player_id) values (new_player_id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

alter table public.players        enable row level security;
alter table public.player_ratings enable row level security;

-- Any authenticated user can read players (needed for leaderboards / profiles).
create policy "players readable by authenticated"
  on public.players for select
  to authenticated
  using (true);

-- A user may update only their own profile.
create policy "player can update own profile"
  on public.players for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Any authenticated user can read ratings.
create policy "ratings readable by authenticated"
  on public.player_ratings for select
  to authenticated
  using (true);

-- NOTE: there is deliberately NO insert/update policy on player_ratings for
-- the `authenticated` role. Ratings are written only by the rating engine
-- (Edge Function using the service role, which bypasses RLS). This is what
-- makes ratings non-cheatable from the client.
