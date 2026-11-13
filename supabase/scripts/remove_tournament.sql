-- Deletes a tournament and every trace of it: its bracket and players, the
-- matches played in it (with their scores and rating history) and the season
-- points it awarded. Ratings are then recalculated as if those matches had
-- never been played: for the players in it, and for anyone who played them
-- afterwards. It uses the same Glicko-2 math as the app
-- (supabase/functions/_shared/glicko2.ts and engine.ts).
--
-- Titles and tiers follow: the tournament's champion title (and laurel),
-- Finalist, Dark Horse, Beast Killer, or any title that came from its matches,
-- goes if it isn't earned some other way; a title shown under a name that's
-- gone is cleared, and if it's earned again later it's announced again. Tiers
-- move with the new ratings, without "promoted" notifications. The preview
-- lists every title and tier that changes.
--
-- HOW TO RUN (Supabase dashboard -> SQL Editor). Nothing changes until step 3.
--   1. Paste this whole script and Run it as it is. The result lists every
--      tournament: its name, status, and when and by whom it was created.
--   2. At the bottom, replace null on the tournament line with the name of the
--      one to delete, in quotes, e.g.
--        tournament => 'Test cup',
--      and Run again. This is a PREVIEW: what would be deleted, and every
--      rating that would move.
--   3. If that looks right, change preview => true to preview => false and
--      Run again. It all happens in one go: if anything goes wrong, nothing is
--      changed.
-- Supabase may warn about a "destructive operation" before running: in steps
-- 1 and 2 nothing is changed, so it's safe to confirm.
--
-- The helper functions live in pg_temp: they disappear on their own when the
-- SQL Editor session ends and leave nothing behind in the database.

-- Glicko-2 (same constants as GLICKO2 in glicko2.ts: scale 173.7178, tau 0.5).

create or replace function pg_temp.g2_vol_f(x float8, a float8, d2 float8, phi2 float8, v float8)
returns float8 language sql immutable as $$
  select exp(x) * (d2 - phi2 - v - exp(x)) / (2 * power(phi2 + v + exp(x), 2)) - (x - a) / (0.5 * 0.5)
$$;

-- New volatility via the Illinois algorithm (newVolatility in glicko2.ts).
create or replace function pg_temp.g2_volatility(sigma float8, phi float8, v float8, delta float8)
returns float8 language plpgsql immutable as $$
declare
  tau constant float8 := 0.5;
  a constant float8 := ln(sigma * sigma);
  d2 constant float8 := delta * delta;
  phi2 constant float8 := phi * phi;
  x_a float8 := a;
  x_b float8;
  x_c float8;
  f_a float8;
  f_b float8;
  f_c float8;
  k integer := 1;
begin
  if d2 > phi2 + v then
    x_b := ln(d2 - phi2 - v);
  else
    while pg_temp.g2_vol_f(a - k * tau, a, d2, phi2, v) < 0 loop
      k := k + 1;
    end loop;
    x_b := a - k * tau;
  end if;
  f_a := pg_temp.g2_vol_f(x_a, a, d2, phi2, v);
  f_b := pg_temp.g2_vol_f(x_b, a, d2, phi2, v);
  while abs(x_b - x_a) > 1e-6 loop
    x_c := x_a + (x_a - x_b) * f_a / (f_b - f_a);
    f_c := pg_temp.g2_vol_f(x_c, a, d2, phi2, v);
    if f_c * f_b <= 0 then
      x_a := x_b;
      f_a := f_b;
    else
      f_a := f_a / 2;
    end if;
    x_b := x_c;
    f_b := f_c;
  end loop;
  return exp(x_a / 2);
end $$;

-- One match against one opponent (updateRating): score 1 = win, 0 = loss.
create or replace function pg_temp.g2_update(
  r float8, rd float8, vol float8, opp_r float8, opp_rd float8, score float8,
  out new_r float8, out new_rd float8, out new_vol float8)
language plpgsql immutable as $$
declare
  scale constant float8 := 173.7178;
  mu constant float8 := (r - 1500) / scale;
  phi constant float8 := rd / scale;
  g constant float8 := 1 / sqrt(1 + 3 * power(opp_rd / scale, 2) / power(pi(), 2));
  e constant float8 := 1 / (1 + exp(-g * (mu - (opp_r - 1500) / scale)));
  v constant float8 := 1 / (g * g * e * (1 - e));
  sigma_new float8;
  phi_new float8;
begin
  sigma_new := pg_temp.g2_volatility(vol, phi, v, v * g * (score - e));
  phi_new := 1 / sqrt(1 / (phi * phi + sigma_new * sigma_new) + 1 / v);
  new_r := (mu + phi_new * phi_new * g * (score - e)) * scale + 1500;
  new_rd := phi_new * scale;
  new_vol := sigma_new;
end $$;

-- RD growth for the time since the player's previous match (decay in
-- engine.ts: one rating period = 7 days, never above 350).
create or replace function pg_temp.g2_decayed_rd(rd float8, vol float8, last_at timestamptz, rated_at timestamptz)
returns float8 language sql immutable as $$
  select case
    when last_at is null or rated_at <= last_at then rd
    else least(
      sqrt(power(rd / 173.7178, 2)
           + vol * vol * extract(epoch from (rated_at - last_at))::float8 / (7 * 86400)) * 173.7178,
      350)
  end
$$;

-- Same-opponent damping (repeatFactor in glicko2.ts), from the number of
-- confirmed matches the pair had already played in the previous 24 h.
create or replace function pg_temp.repeat_factor(prior_today integer)
returns float8 language sql immutable as $$
  select (case when prior_today <= 1 then 1
               when prior_today = 2 then 0.5
               when prior_today = 3 then 0.25
               else 0 end)::float8
$$;

create or replace function pg_temp.remove_tournament(tournament text default null, preview boolean default true)
returns table (what text, currently text, after_cleanup text)
language plpgsql as $$
declare
  t public.tournaments%rowtype;
  n_found integer;
  creator text;
  removed uuid[];      -- the tournament's matches
  t0 timestamptz;      -- when the first of them changed anyone's rating
  m record;
  ea public.rating_events%rowtype;
  eb public.rating_events%rowtype;
  sa record;
  sb record;
  factor float8;
  ctx text;
  rd_a float8;
  rd_b float8;
  ua record;
  ub record;
  r_a float8;
  r_b float8;
  replayed boolean := false;  -- ratings were recalculated (some match had been rated)
  sep constant text := chr(31);
  titles_before text[];
  titles_after text[];
  shown_before text[];
  tiers_before text[];
  tiers_after text[];
begin
  -- Which tournament: by name (any capitals) or by id.
  select count(*) into n_found from public.tournaments x
   where tournament is not null
     and (lower(trim(x.name)) = lower(trim(tournament)) or x.id::text = trim(tournament));

  -- No name yet, a name that matches nothing, or one shared by several:
  -- list the tournaments to choose from, and change nothing.
  if n_found <> 1 then
    return query
    select l.c1, l.c2, l.c3 from (
      select 0 as k, null::timestamptz as at,
             case
               when tournament is null then 'Pick the tournament'
               when n_found = 0 then format('No tournament is called "%s"', tournament)
               else format('%s tournaments are called "%s"', n_found, tournament)
             end as c1,
             format('%s tournament%s in total',
                    (select count(*) from public.tournaments),
                    case when (select count(*) from public.tournaments) = 1 then '' else 's' end) as c2,
             case when n_found > 1
                  then 'Put the id (third column) of the one to delete on the tournament line, then Run again'
                  else 'Put the name of the one to delete on the tournament line at the bottom, then Run again'
             end as c3
      union all
      select 1, x.created_at,
             format('"%s"', x.name),
             format('%s · created %s by %s%s', x.status, to_char(x.created_at, 'DD Mon YYYY HH24:MI'),
                    coalesce(pl.display_name, 'unknown'),
                    case when exists (select 1 from public.admins a where a.player_id = x.created_by)
                         then ' (admin)' else ' (not an admin)' end),
             'id: ' || x.id::text
        from public.tournaments x
        left join public.players pl on pl.id = x.created_by
       where n_found = 0 or lower(trim(x.name)) = lower(trim(tournament))
    ) l
    order by l.k, l.at desc;
    return;
  end if;

  select * into t from public.tournaments x
   where lower(trim(x.name)) = lower(trim(tournament)) or x.id::text = trim(tournament);
  select format('%s by %s%s', to_char(t.created_at, 'DD Mon YYYY HH24:MI'), coalesce(pl.display_name, 'unknown'),
                case when exists (select 1 from public.admins a where a.player_id = t.created_by)
                     then ' (admin)' else ' (not an admin)' end)
    into creator
    from public.players pl where pl.id = t.created_by;

  select coalesce(array_agg(distinct x.id), '{}') into removed
  from (
    select id from public.matches where tournament_id = t.id
    union
    select match_id from public.tournament_matches where tournament_id = t.id and match_id is not null
  ) x;

  drop table if exists pg_temp.report;
  create temp table report (ord serial, c_what text, c_now text, c_after text);

  insert into report (c_what, c_now, c_after) values
    ('Mode',
     case when preview then 'PREVIEW - nothing has been changed' else 'DONE - changes applied' end,
     case when preview then 'To delete it: change preview => true to preview => false at the bottom and Run again' else '' end),
    ('Tournament', format('%s (%s)', t.name, t.status), 'deleted'),
    ('Created', coalesce(creator, to_char(t.created_at, 'DD Mon YYYY HH24:MI')), ''),
    ('Players in it',
     (select count(*) from public.tournament_participants p where p.tournament_id = t.id)::text, '0'),
    ('Matches played in it', cardinality(removed)::text, '0');

  insert into report (c_what, c_now, c_after)
  select format('Season points: %s', pl.display_name), format('%s (%s)', sp.points, sp.placement), '0'
    from public.season_points sp
    join public.players pl on pl.id = sp.player_id
   where sp.tournament_id = t.id
   order by sp.points desc;

  -- Titles, shown titles and tiers as they are now, to compare with after.
  select coalesce(array_agg(e.player_id::text || sep || e.title || sep || e.label), '{}')
    into titles_before from public.earned_titles e;
  select coalesce(array_agg(p.id::text || sep || p.title), '{}')
    into shown_before from public.players p where p.title is not null;
  select coalesce(array_agg(pt.player_id::text || sep || pt.tier), '{}')
    into tiers_before from public.player_tiers pt;

  -- Recalculate ratings from just before the tournament's first match.
  select min(created_at) into t0 from public.rating_events where match_id = any(removed);

  if t0 is not null then
    -- Each player's rating as it stood just before that moment. "touched"
    -- marks players whose rating has to be recalculated: the tournament's
    -- players, plus (below) anyone who played one of them afterwards.
    drop table if exists pg_temp.rstate;
    create temp table rstate as
    select pr.player_id,
           coalesce(prev.rating_after, 1500)::float8 as rating,
           coalesce(prev.rd_after, 350)::float8 as rd,
           coalesce(prev.volatility_after, 0.06)::float8 as vol,
           (select count(*) from public.rating_events e
             where e.player_id = pr.player_id and e.created_at < t0)::int as n,
           prev.created_at as last_at,
           exists (select 1 from public.rating_events e
                    where e.player_id = pr.player_id and e.match_id = any(removed)) as touched
      from public.player_ratings pr
      left join lateral (
        select e.rating_after, e.rd_after, e.volatility_after, e.created_at
          from public.rating_events e
         where e.player_id = pr.player_id and e.created_at < t0
         order by e.created_at desc
         limit 1
      ) prev on true;

    -- The recalculated rating events, written below.
    drop table if exists pg_temp.ev_new;
    create temp table ev_new (
      id uuid primary key, rating_before float8, rd_before float8, volatility_before float8,
      rating_after float8, rd_after float8, volatility_after float8, delta float8,
      repeat_factor float8, provisional boolean
    );
    replayed := true;

    -- Replay every other rated match since then, oldest first. A match with
    -- no touched player keeps its stored numbers; one with a touched player
    -- is recalculated (and touches both players).
    for m in
      select e.match_id, min(e.created_at) as rated_at
        from public.rating_events e
       where e.created_at >= t0 and not (e.match_id = any(removed))
       group by e.match_id
       order by min(e.created_at), e.match_id
    loop
      select * into ea from public.rating_events where match_id = m.match_id order by player_id limit 1;
      select * into eb from public.rating_events where match_id = m.match_id and id <> ea.id;
      if eb.id is null then
        raise exception 'Match % has only one rating event; stopping without changing anything', m.match_id;
      end if;
      select * into sa from rstate where player_id = ea.player_id;
      select * into sb from rstate where player_id = eb.player_id;

      if sa.touched or sb.touched then
        factor := ea.repeat_factor;
        -- A casual match's same-opponent damping counted the pair's matches
        -- from the previous 24 h: recount if a removed match was among them.
        select context into ctx from public.matches where id = m.match_id;
        if ctx = 'casual' and exists (
          select 1 from public.matches x
           where x.id = any(removed)
             and ((x.player_a = ea.player_id and x.player_b = eb.player_id)
               or (x.player_a = eb.player_id and x.player_b = ea.player_id))
             and x.played_at >= m.rated_at - interval '24 hours'
             and (select min(created_at) from public.rating_events where match_id = x.id) < m.rated_at
        ) then
          select pg_temp.repeat_factor(count(*)::int) into factor
            from public.matches x
           where x.id <> m.match_id
             and not (x.id = any(removed))
             and x.status = 'confirmed'
             and ((x.player_a = ea.player_id and x.player_b = eb.player_id)
               or (x.player_a = eb.player_id and x.player_b = ea.player_id))
             and x.played_at >= m.rated_at - interval '24 hours'
             and (select min(created_at) from public.rating_events where match_id = x.id) < m.rated_at;
        end if;

        rd_a := pg_temp.g2_decayed_rd(sa.rd, sa.vol, sa.last_at, m.rated_at);
        rd_b := pg_temp.g2_decayed_rd(sb.rd, sb.vol, sb.last_at, m.rated_at);
        select * into ua from pg_temp.g2_update(sa.rating, rd_a, sa.vol, sb.rating, rd_b,
                                                case when ea.result = 'win' then 1 else 0 end);
        select * into ub from pg_temp.g2_update(sb.rating, rd_b, sb.vol, sa.rating, rd_a,
                                                case when eb.result = 'win' then 1 else 0 end);
        r_a := sa.rating + (ua.new_r - sa.rating) * factor;
        r_b := sb.rating + (ub.new_r - sb.rating) * factor;

        insert into ev_new values
          (ea.id, sa.rating, rd_a, sa.vol, r_a, ua.new_rd, ua.new_vol, r_a - sa.rating, factor, sa.n < 3),
          (eb.id, sb.rating, rd_b, sb.vol, r_b, ub.new_rd, ub.new_vol, r_b - sb.rating, factor, sb.n < 3);

        update rstate set rating = r_a, rd = ua.new_rd, vol = ua.new_vol, n = n + 1,
                          last_at = m.rated_at, touched = true
         where player_id = ea.player_id;
        update rstate set rating = r_b, rd = ub.new_rd, vol = ub.new_vol, n = n + 1,
                          last_at = m.rated_at, touched = true
         where player_id = eb.player_id;
      else
        update rstate set rating = ea.rating_after, rd = ea.rd_after, vol = ea.volatility_after,
                          n = n + 1, last_at = m.rated_at
         where player_id = ea.player_id;
        update rstate set rating = eb.rating_after, rd = eb.rd_after, vol = eb.volatility_after,
                          n = n + 1, last_at = m.rated_at
         where player_id = eb.player_id;
      end if;
    end loop;

    insert into report (c_what, c_now, c_after)
    select format('Rating: %s', pl.display_name),
           format('%s ± %s · %s match%s', round(pr.rating), round(pr.rd), pr.matches_played,
                  case when pr.matches_played = 1 then '' else 'es' end),
           format('%s ± %s · %s match%s', round(s.rating), round(s.rd), s.n,
                  case when s.n = 1 then '' else 'es' end)
      from rstate s
      join public.player_ratings pr on pr.player_id = s.player_id
      join public.players pl on pl.id = s.player_id
     where s.touched
     order by pl.display_name;
  end if;

  -- Apply it all. A preview undoes it at the end of this block, once it has
  -- seen what titles and tiers become.
  begin
    if replayed then
      update public.rating_events e
         set rating_before = n.rating_before, rd_before = n.rd_before, volatility_before = n.volatility_before,
             rating_after = n.rating_after, rd_after = n.rd_after, volatility_after = n.volatility_after,
             delta = n.delta, repeat_factor = n.repeat_factor, provisional = n.provisional
        from ev_new n
       where e.id = n.id;
      update public.player_ratings pr
         set rating = s.rating, rd = s.rd, volatility = s.vol, matches_played = s.n,
             last_played_at = s.last_at, updated_at = now()
        from rstate s
       where s.player_id = pr.player_id and s.touched;
    end if;

    delete from public.tournaments where id = t.id;       -- also its participants, bracket and season points
    delete from public.matches where id = any(removed);   -- also their scores and rating events

    -- New tiers from the new ratings aren't news: no "promoted" notification.
    update public.tier_changes set notified = true where changed_at = now() and not notified;

    -- Titles no longer earned: cleared from under names, and forgotten as
    -- announced (so earning one again later is announced again).
    drop table if exists pg_temp.still_earned;
    create temp table still_earned as select player_id, title, label from public.earned_titles;
    update public.players p set title = null
     where p.title is not null
       and not exists (select 1 from still_earned e where e.player_id = p.id and e.title = p.title);
    delete from public.achievement_notices n
     where not exists (select 1 from still_earned e
                        where e.player_id = n.player_id
                          and e.title = case when n.code = 'champion' then 'champion:' || n.ref else n.code end);

    select coalesce(array_agg(e.player_id::text || sep || e.title || sep || e.label), '{}')
      into titles_after from still_earned e;
    select coalesce(array_agg(pt.player_id::text || sep || pt.tier), '{}')
      into tiers_after from public.player_tiers pt;

    if preview then
      raise exception using errcode = 'PV001', message = 'preview: undo';
    end if;
  exception when sqlstate 'PV001' then
    null;  -- a preview: everything in the block is undone; what it found is kept above
  end;

  insert into report (c_what, c_now, c_after)
  select format('Title: %s', pl.display_name),
         case when d.lost then d.label else '-' end,
         case when not d.lost then d.label || ' (earned)'
              when (d.player_id::text || sep || d.title) = any(shown_before) then 'removed (and from under their name)'
              else 'removed' end
    from (
      select split_part(v, sep, 1)::uuid as player_id, split_part(v, sep, 2) as title,
             split_part(v, sep, 3) as label, true as lost
        from unnest(titles_before) v where not (v = any(titles_after))
      union all
      select split_part(v, sep, 1)::uuid, split_part(v, sep, 2), split_part(v, sep, 3), false
        from unnest(titles_after) v where not (v = any(titles_before))
    ) d
    join public.players pl on pl.id = d.player_id
   order by pl.display_name, d.lost desc, d.label;

  insert into report (c_what, c_now, c_after)
  select format('Tier: %s', pl.display_name), initcap(b.tier), initcap(a.tier)
    from (select split_part(v, sep, 1)::uuid as player_id, split_part(v, sep, 2) as tier from unnest(tiers_before) v) b
    join (select split_part(v, sep, 1)::uuid as player_id, split_part(v, sep, 2) as tier from unnest(tiers_after) v) a
      on a.player_id = b.player_id
    join public.players pl on pl.id = b.player_id
   where a.tier <> b.tier
   order by pl.display_name;

  return query select r.c_what, r.c_now, r.c_after from report r order by r.ord;
end $$;

select * from pg_temp.remove_tournament(
  tournament => null,  -- step 2: the tournament's name in quotes, e.g. 'Test cup'
  preview    => true   -- step 3: false to delete it
);
