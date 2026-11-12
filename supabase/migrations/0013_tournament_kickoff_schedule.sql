-- 0013_tournament_kickoff_schedule.sql
-- Starts tournaments on time. Every minute the database checks whether a
-- tournament has reached its kickoff with at least 4 players; if one has, it
-- calls the tournament-kickoff Edge Function, which makes the draw and tells
-- every player who they play. Nothing is called while nothing is due.
--
-- Uses Supabase's pg_cron (scheduling) and pg_net (HTTP) extensions. If they
-- can't be turned on here, this migration still succeeds and only warns: the
-- app then starts a due tournament the moment someone opens it. To schedule
-- it later, turn both on in the dashboard (Database -> Extensions) and run
-- the `do` block at the end of this file in the SQL Editor.

-- Calls tournament-kickoff if a tournament is due. The function URL is this
-- project's (the same ref as .github/workflows/supabase-deploy.yml); it isn't
-- a secret and the function takes no input.
create or replace function public.request_tournament_kickoff()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
      from public.tournaments t
     where t.status = 'registration'
       and t.kickoff_at <= now()
       and (select count(*) from public.tournament_participants tp where tp.tournament_id = t.id) >= 4
  ) then
    perform net.http_post(
      url := 'https://fdugzpsuznitvqwnrtim.supabase.co/functions/v1/tournament-kickoff',
      body := '{}'::jsonb,
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  end if;
end;
$$;

revoke all on function public.request_tournament_kickoff() from public, anon, authenticated;

do $$
begin
  create extension if not exists pg_net;
  create extension if not exists pg_cron;
  -- What Supabase's pg_cron guide grants, in case this role lacks it; if it
  -- isn't ours to grant, scheduling below still works or warns.
  begin
    grant usage on schema cron to postgres;
    grant all privileges on all tables in schema cron to postgres;
  exception when others then
    null;
  end;
  perform cron.schedule('tournament-kickoff', '* * * * *', 'select public.request_tournament_kickoff()');
  -- pg_cron keeps a row per run; keep a week of them.
  perform cron.schedule(
    'tournament-kickoff-history-cleanup',
    '17 3 * * *',
    $job$delete from cron.job_run_details where end_time < now() - interval '7 days'$job$
  );
exception when others then
  raise warning 'Tournaments won''t start on their own until pg_cron and pg_net are on (%). See 0013_tournament_kickoff_schedule.sql.', sqlerrm;
end;
$$;
