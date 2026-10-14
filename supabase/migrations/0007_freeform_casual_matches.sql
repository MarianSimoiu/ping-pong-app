-- 0007_freeform_casual_matches.sql
-- Casual matches no longer pick a best-of-N format — players record however
-- many games they actually played, and `best_of` stores that real count.
-- Tournament matches are unaffected: they still use a fixed 1/3/5/7 format
-- per tournament, which stays within this wider range.

alter table public.matches drop constraint if exists matches_best_of_check;
alter table public.matches add constraint matches_best_of_check check (best_of between 1 and 21);
