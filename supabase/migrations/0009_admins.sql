-- 0009_admins.sql
-- Admins: the only players allowed to create tournaments (enforced by the
-- create-tournament Edge Function). There is no insert/update/delete policy,
-- so nobody can make themselves an admin from the app: rows are added in the
-- Supabase SQL Editor (see docs/DEPLOYMENT.md, "Admins").

create table public.admins (
  player_id  uuid primary key references public.players (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- Signed-in players can see who the admins are (the app uses it to show
-- "+ New" on the Tournaments tab only to them).
create policy "admins readable by authenticated"
  on public.admins for select to authenticated using (true);

-- Explicit grants rather than Supabase's defaults (which from 2026-10-30 no
-- longer expose new tables to the Data API): read-only for signed-in users,
-- nothing for anonymous visitors.
revoke all on public.admins from anon, authenticated;
grant select on public.admins to authenticated, service_role;
