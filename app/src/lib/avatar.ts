import { Platform } from 'react-native';

import { demoSetAvatar } from '@/lib/demo';
import { DEMO } from '@/lib/env';
import { supabase } from '@/lib/supabase';

// Profile pictures are shown at most 80px wide, and every leaderboard viewer
// downloads each one. The web photo picker ignores the picker's crop/quality
// options and hands back the original photo (often several MB), so on the web
// center-crop and shrink it to a small square JPEG (~20 KB) before uploading.
// The native picker already crops and compresses.
const AVATAR_PX = 256;

async function shrinkForAvatar(localUri: string): Promise<Blob> {
  if (Platform.OS !== 'web') return (await fetch(localUri)).blob();

  const img = new Image();
  img.src = localUri;
  await img.decode();
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_PX;
  canvas.height = AVATAR_PX;
  canvas
    .getContext('2d')!
    .drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_PX,
      AVATAR_PX,
    );
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not process that photo'))),
      'image/jpeg',
      0.85,
    ),
  );
}

// Uploads the image at `localUri` (from expo-image-picker) as the user's
// profile picture and returns the URL to store on players.avatar_url.
export async function uploadAvatar(userId: string, localUri: string): Promise<string> {
  const blob = await shrinkForAvatar(localUri);

  if (DEMO) {
    const uri = Platform.OS === 'web' ? URL.createObjectURL(blob) : localUri;
    demoSetAvatar(uri);
    return uri;
  }

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
