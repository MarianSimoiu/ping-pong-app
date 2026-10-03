import { demoSetAvatar } from '@/lib/demo';
import { DEMO } from '@/lib/env';
import { supabase } from '@/lib/supabase';

// Uploads the image at `localUri` (from expo-image-picker) as the user's
// profile picture and returns the URL to store on players.avatar_url.
export async function uploadAvatar(userId: string, localUri: string): Promise<string> {
  if (DEMO) {
    demoSetAvatar(localUri);
    return localUri;
  }

  const blob = await (await fetch(localUri)).blob();
  const path = `${userId}/avatar.jpg`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  // Cache-bust: the path is fixed (upsert overwrites it), so without this a
  // previously-cached image would keep showing after a new upload.
  const publicUrl = `${data.publicUrl}?t=${Date.now()}`;

  const { error: updateError } = await supabase
    .from('players')
    .update({ avatar_url: publicUrl })
    .eq('user_id', userId);
  if (updateError) throw updateError;

  return publicUrl;
}
