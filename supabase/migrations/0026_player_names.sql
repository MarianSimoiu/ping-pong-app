-- 0026_player_names.sql
-- Players change their name from Profile → Settings, with a plain update of
-- their own players row (RLS has always allowed that). This keeps a changed
-- name tidy and unambiguous:
--
--   * spaces trimmed from the ends, and a run of spaces inside made one;
--   * 2 to 30 characters;
--   * not another player's name, ignoring case and spacing, so nobody can
--     pass for someone else on the leaderboard or in the opponent list.
--
-- Only a change is checked: names given at sign-up, and names already in use,
-- stay as they are until their player changes them.

create or replace function public.player_name_tidy(name text)
returns text
language sql
immutable
as $$
  -- Any whitespace (tabs and newlines too) to one space first, then trimmed:
  -- btrim alone would leave a tab at the end.
  select btrim(regexp_replace(name, '\s+', ' ', 'g'))
$$;

create or replace function public.player_name_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tidy text := public.player_name_tidy(new.display_name);
begin
  if new.display_name is not distinct from old.display_name then
    return new;
  end if;
  if char_length(tidy) not between 2 and 30 then
    raise exception 'A name needs 2 to 30 characters.' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.players p
     where p.id <> new.id
       and lower(public.player_name_tidy(p.display_name)) = lower(tidy)
  ) then
    raise exception 'Someone already goes by %. Add an initial or a nickname so people can tell you apart.', tidy
      using errcode = 'unique_violation';
  end if;
  new.display_name := tidy;
  return new;
end;
$$;

revoke all on function public.player_name_check() from public, anon, authenticated;

create trigger players_name_check
  before update of display_name on public.players
  for each row execute function public.player_name_check();
