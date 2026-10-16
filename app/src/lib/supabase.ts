import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, FunctionsHttpError } from '@supabase/supabase-js';

import { DEMO, SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env';

// In DEMO mode (no Supabase env) the client is never actually used — every data
// function short-circuits to the in-memory demo backend — but we still create a
// harmless placeholder so imports don't crash.
export const supabase = createClient(
  SUPABASE_URL ?? 'http://demo.invalid',
  SUPABASE_ANON_KEY ?? 'demo-anon-key',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: !DEMO,
      persistSession: !DEMO,
      detectSessionInUrl: false,
    },
  },
);

// On a non-2xx Edge Function response, supabase-js throws before reading the
// body, so `data` is always null and the function's actual `{ error }` JSON
// (every function in this app returns one) only lives on the unread Response
// at `error.context`. This pulls the real reason out instead of leaving
// callers stuck with the SDK's generic "non-2xx status code" message.
export async function functionErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.error) return body.error as string;
    } catch {
      // Body wasn't JSON or already read — fall through to the generic message.
    }
  }
  return error instanceof Error ? error.message : 'Something went wrong';
}
