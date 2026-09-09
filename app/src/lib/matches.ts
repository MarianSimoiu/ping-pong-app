import { supabase } from '@/lib/supabase';
import type { OpponentOption, SubmitMatchResult } from '@/lib/types';

export type RawGameInput = { score_a: number; score_b: number };

// Everyone except the signed-in user, as opponent options.
export async function fetchOpponents(myUserId: string): Promise<OpponentOption[]> {
  const { data, error } = await supabase
    .from('players')
    .select('id, display_name')
    .neq('user_id', myUserId)
    .order('display_name');
  if (error) throw error;
  return (data ?? []) as OpponentOption[];
}

// Record a match by invoking the server-side Edge Function (which computes and
// writes ratings). Scores are from the caller's perspective: a = you, b = them.
export async function submitMatch(input: {
  opponentId: string;
  bestOf: number;
  games: RawGameInput[];
}): Promise<SubmitMatchResult> {
  const { data, error } = await supabase.functions.invoke<SubmitMatchResult>('submit-match', {
    body: input,
  });
  if (error) {
    // Surface the function's JSON error message when present.
    const message = (data as { error?: string } | null)?.error ?? error.message;
    throw new Error(message);
  }
  if (!data) throw new Error('No response from submit-match');
  return data;
}
