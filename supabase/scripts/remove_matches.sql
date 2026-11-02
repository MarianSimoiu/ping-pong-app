-- Deletes chosen matches between two players (with their scores and rating
-- history), then recalculates ratings as if those matches had never been
-- played: for the two players, and for anyone who played either of them
-- afterwards. It uses the same Glicko-2 math as the app
-- (supabase/functions/_shared/glicko2.ts and engine.ts).
--
-- HOW TO RUN (Supabase dashboard -> SQL Editor). Nothing changes until step 3.
--   1. At the bottom, replace 'First player' and 'Second player' with the two
--      players' names as the app shows them (or the emails they sign in with),
--      then Run. The result lists every match between them, newest first, each
--      with an 8-character code.
--   2. Put the codes of the matches to delete on the matches line, e.g.
--        matches => array['1a2b3c4d', '5e6f7a8b'],
--      and Run again. This is a PREVIEW: what would be deleted, and every
--      rating that would move.
--   3. If that looks right, change preview => true to preview => false and
--      Run again. It all happens in one go: if anything goes wrong, nothing is
--      changed.
-- Supabase may warn about a "destructive operation" before running: in steps
-- 1 and 2 nothing is changed, so it's safe to confirm.
--
-- Only casual matches can be deleted here: a tournament match belongs to its
-- bracket. The helper functions live in pg_temp: they disappear on their own
-- when the SQL Editor session ends and leave nothing behind in the database.

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

-- The player with this name (as the app shows it) or sign-in email.
create or replace function pg_temp.player_called(who text)
returns uuid language plpgsql stable as $$
declare
  ids uuid[];
begin
  select array_agg(p.id) into ids
    from public.players p
    left join auth.users u on u.id = p.user_id
   where lower(trim(p.display_name)) = lower(trim(who))
      or lower(u.email) = lower(trim(who));
  if ids is null then
    raise exception 'No player called "%". Use the name the app shows, or the email they sign in with.', who;
  elsif cardinality(ids) > 1 then
    raise exception 'More than one player is called "%". Use the email they sign in with instead.', who;
  end if;
  return ids[1];
end $$;

-- One line per match: when, who beat whom, the games, and what it did to ratings.
create or replace function pg_temp.match_summary(mid uuid)
returns text language sql stable as $$
  select format('%s UTC · %s beat %s%s · %s',
           to_char(m.played_at at time zone 'UTC', 'DD Mon YYYY HH24:MI'),
           w.display_name, l.display_name,
           case when g.won + g.lost = 0 then ''
                else format(' %s–%s (%s)', g.won, g.lost, g.scores) end,
           case m.status
             when 'confirmed' then coalesce('rating ' || ev.moves, 'confirmed')
             when 'pending' then 'pending: no rating change yet'
             else 'declined: no rating change' end)
    from public.matches m
    join public.players w on w.id = m.winner_id
    join public.players l on l.id = case when m.winner_id = m.player_a then m.player_b else m.player_a end
    cross join lateral (
      select count(*) filter (where s.w > s.l) as won,
             count(*) filter (where s.w < s.l) as lost,
             string_agg(s.w || '–' || s.l, ', ' order by s.game_no) as scores
        from (select x.game_no,
                     case when m.winner_id = m.player_a then x.score_a else x.score_b end as w,
                     case when m.winner_id = m.player_a then x.score_b else x.score_a end as l
                from public.match_games x where x.match_id = m.id) s
    ) g
    left join lateral (
      select string_agg(format('%s %s%s', p.display_name, case when e.delta >= 0 then '+' else '' end,
                               round(e.delta)::int), ', ' order by e.delta desc) as moves
        from public.rating_events e
        join public.players p on p.id = e.player_id
       where e.match_id = m.id
    ) ev on true
   where m.id = mid
$$;

create or replace function pg_temp.remove_matches(
  player_1 text, player_2 text, matches text[] default null, preview boolean default true)
returns table (what text, currently text, after_cleanup text)
language plpgsql as $$
declare
  p1 uuid := pg_temp.player_called(player_1);
  p2 uuid := pg_temp.player_called(player_2);
  code text;
  c text;
  hit uuid[];
  removed uuid[] := '{}';
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
begin
  if p1 = p2 then
    raise exception '"%" and "%" are the same player', player_1, player_2;
  end if;

  drop table if exists pg_temp.report;
  create temp table report (ord serial, c_what text, c_now text, c_after text);

  -- Step 1: no codes yet, so list the pair's matches.
  if matches is null or cardinality(matches) = 0 then
    insert into report (c_what, c_now, c_after) values
      ('Mode', 'LIST - nothing has been changed',
       'Put the codes of the matches to delete on the matches line, e.g. matches => array[''1a2b3c4d''], and run again');
    insert into report (c_what, c_now, c_after)
    select format('Match %s', left(x.id::text, 8)),
           pg_temp.match_summary(x.id),
           case when x.context = 'tournament' then 'tournament match: can''t be deleted here' else '' end
      from public.matches x
     where (x.player_a = p1 and x.player_b = p2) or (x.player_a = p2 and x.player_b = p1)
     order by x.played_at desc;
    if not found then
      insert into report (c_what, c_now, c_after) values ('Matches', 'none between these two players', '');
    end if;
    return query select r.c_what, r.c_now, r.c_after from report r order by r.ord;
    return;
  end if;

  -- Which matches the codes stand for.
  foreach code in array matches loop
    c := lower(trim(code));
    if c !~ '^[0-9a-f-]{6,36}$' then
      raise exception '"%" is not a match code: copy the 8-character code from the list', code;
    end if;
    select array_agg(x.id) into hit
      from public.matches x
     where ((x.player_a = p1 and x.player_b = p2) or (x.player_a = p2 and x.player_b = p1))
       and x.id::text like c || '%';
    if hit is null then
      raise exception 'No match with code "%" between % and %. Set matches => null to list their matches.',
        code, player_1, player_2;
    elsif cardinality(hit) > 1 then
      raise exception 'Code "%" fits more than one of their matches: use more characters of it', code;
    end if;
    if (select context from public.matches where id = hit[1]) = 'tournament' then
      raise exception 'Match % is a tournament match, which belongs to its bracket: it can''t be deleted here', code;
    end if;
    if not hit[1] = any(removed) then
      removed := removed || hit[1];
    end if;
  end loop;

  insert into report (c_what, c_now, c_after) values
    ('Mode',
     case when preview then 'PREVIEW - nothing has been changed' else 'DONE - changes applied' end,
     case when preview then 'To apply: change preview => true to false at the bottom and run again' else '' end);
  insert into report (c_what, c_now, c_after)
  select format('Match %s', left(x.id::text, 8)), pg_temp.match_summary(x.id), 'deleted'
    from public.matches x
   where x.id = any(removed)
   order by x.played_at;

  -- Recalculate ratings from just before the first deleted match that was rated.
  select min(created_at) into t0 from public.rating_events where match_id = any(removed);

  if t0 is not null then
    -- Each player's rating as it stood just before that moment. "touched"
    -- marks players whose rating has to be recalculated: the two players,
    -- plus (below) anyone who played one of them afterwards.
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
        -- from the previous 24 h: recount if a deleted match was among them.
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

        if not preview then
          update public.rating_events
             set rating_before = sa.rating, rd_before = rd_a, volatility_before = sa.vol,
                 rating_after = r_a, rd_after = ua.new_rd, volatility_after = ua.new_vol,
                 delta = r_a - sa.rating, repeat_factor = factor, provisional = sa.n < 3
           where id = ea.id;
          update public.rating_events
             set rating_before = sb.rating, rd_before = rd_b, volatility_before = sb.vol,
                 rating_after = r_b, rd_after = ub.new_rd, volatility_after = ub.new_vol,
                 delta = r_b - sb.rating, repeat_factor = factor, provisional = sb.n < 3
           where id = eb.id;
        end if;

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

    if not preview then
      update public.player_ratings pr
         set rating = s.rating, rd = s.rd, volatility = s.vol, matches_played = s.n,
             last_played_at = s.last_at, updated_at = now()
        from rstate s
       where s.player_id = pr.player_id and s.touched;
    end if;
  else
    insert into report (c_what, c_now, c_after)
    values ('Ratings', 'none of these matches changed a rating', 'unchanged');
  end if;

  if not preview then
    delete from public.matches where id = any(removed);   -- also their scores and rating events
  end if;

  return query select r.c_what, r.c_now, r.c_after from report r order by r.ord;
end $$;

select * from pg_temp.remove_matches(
  player_1 => 'First player',
  player_2 => 'Second player',
  matches  => null,
  preview  => true
);
