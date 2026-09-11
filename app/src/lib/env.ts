// Central env access. When Supabase isn't configured, the app runs in DEMO
// mode: screens render with built-in sample data and no backend is contacted.
// Configure app/.env (EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY)
// to switch to the real backend.

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const DEMO = !SUPABASE_URL || !SUPABASE_ANON_KEY;
