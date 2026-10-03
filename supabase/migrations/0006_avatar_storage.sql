-- 0006_avatar_storage.sql
-- A public Storage bucket for profile pictures. Reads are public (so
-- players.avatar_url can be a plain public URL); writes are restricted to a
-- user's own folder, keyed by auth.uid().

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true);

create policy "avatar images are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "users can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "users can update their own avatar"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
