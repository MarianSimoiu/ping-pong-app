import { demoMyProfile, demoSetName } from '@/lib/demo';
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

// A name as the server keeps it (migration 0026): any run of whitespace made
// one space, the ends trimmed, and 2 to 30 characters (an emoji counts as one).
export const NAME_MAX_LENGTH = 30;
export const tidyName = (name: string) => name.replace(/\s+/g, ' ').trim();
export const nameFits = (name: string) => {
  const length = [...tidyName(name)].length;
  return length >= 2 && length <= NAME_MAX_LENGTH;
};

// Change the signed-in player's name; returns it as saved. The server refuses
// one that's too short or too long, or another player's (whatever the case),
// and its message says which.
export async function updateMyName(userId: string, name: string): Promise<string> {
  if (DEMO) return demoSetName(name);
  const { data, error } = await supabase
    .from('players')
    .update({ display_name: name })
    .eq('user_id', userId)
    .select('display_name')
    .single();
  if (error) throw new Error(error.message);
  return data.display_name as string;
}

// Whether the signed-in user is an admin (the admins table). Only admins can
// create tournaments; the create-tournament Edge Function enforces it.
export async function fetchIsAdmin(userId: string): Promise<boolean> {
  if (DEMO) return true;
  const { data, error } = await supabase
    .from('admins')
    .select('player_id, players!inner(user_id)')
    .eq('players.user_id', userId);
  if (error) throw error;
  return (data ?? []).length > 0;
}
