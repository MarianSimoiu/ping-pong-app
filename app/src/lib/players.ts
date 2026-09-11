import { demoMyProfile } from '@/lib/demo';
import { DEMO } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import type { PlayerWithRating } from '@/lib/types';

// Fetch the signed-in user's player row joined with their current rating.
export async function fetchMyProfile(userId: string): Promise<PlayerWithRating | null> {
  if (DEMO) return demoMyProfile();
  const { data, error } = await supabase
    .from('players')
    .select('*, rating:player_ratings(*)')
    .eq('user_id', userId)
    .single();

  if (error) throw error;
  if (!data) return null;

  // Supabase returns the embedded relation as an array or object depending on
  // cardinality; normalize to a single rating (or null).
  const rating = Array.isArray(data.rating) ? data.rating[0] ?? null : data.rating ?? null;
  return { ...data, rating } as PlayerWithRating;
}
