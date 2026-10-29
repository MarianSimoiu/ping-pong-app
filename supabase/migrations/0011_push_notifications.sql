-- 0011_push_notifications.sql
-- Push notifications. Every device where a player turns notifications on
-- (Profile → Notifications) has a row in push_subscriptions; the Edge
-- Functions send to those devices when the player has a match to confirm, or
-- when a match they recorded is confirmed or declined.
--
-- push_keys holds the server's own VAPID key pair (the key the app subscribes
-- with, and the one that signs every push). The push-subscription function
-- creates it on first use, so there is nothing to configure.
--
-- Neither table is visible to the app: the app manages its own device's
-- subscription through the push-subscription Edge Function.

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references public.players (id) on delete cascade,
  endpoint    text not null unique,   -- the browser's push-service URL for this device
  p256dh      text not null,          -- the browser's key: notifications are encrypted for it
  auth        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index push_subscriptions_player_idx on public.push_subscriptions (player_id);

create table public.push_keys (
  id           boolean primary key default true check (id),  -- a single row
  public_key   text not null,   -- base64url P-256 public key
  private_jwk  jsonb not null,
  created_at   timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
alter table public.push_keys enable row level security;

-- No policies and no grants for the app: only the Edge Functions (service
-- role) read or write these. Explicit grants, as in 0009 and 0010.
revoke all on public.push_subscriptions, public.push_keys from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions, public.push_keys to service_role;
