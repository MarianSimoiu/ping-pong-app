import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

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
