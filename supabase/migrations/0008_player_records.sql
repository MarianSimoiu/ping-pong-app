-- 0008_player_records.sql
-- Per-player win/loss counts, aggregated in the database. The leaderboard
-- used to download every rating event and count them in the app, which the
-- Data API silently caps at 1,000 rows (about 500 matches), after which the
-- W–L numbers come out too low.

-- security_invoker: the view runs with the caller's rights, so rating_events'
-- RLS still applies (authenticated users can read it).
create view public.player_records
with (security_invoker = on) as
select player_id,
       (count(*) filter (where result = 'win'))::int  as wins,
       (count(*) filter (where result = 'loss'))::int as losses
from public.rating_events
group by player_id;

-- Explicit grant: from 2026-10-30 Supabase no longer exposes new objects to
-- the Data API automatically.
grant select on public.player_records to authenticated;
