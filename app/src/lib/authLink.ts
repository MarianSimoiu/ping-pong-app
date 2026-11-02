import { Platform } from 'react-native';

// What an email link from Supabase Auth (a password reset or a sign-up
// confirmation) brought with it when it opened the app: a session in the
// URL fragment (#access_token=…&refresh_token=…&type=recovery), or the reason
// the link didn't work (#error_description=…). Read once at startup and then
// removed from the address bar, so a reload or a copied URL can't reuse it.
// (The Supabase client doesn't read URLs itself: detectSessionInUrl is off in
// lib/supabase.ts.)

export type AuthLink =
  | { kind: 'session'; type: string; accessToken: string; refreshToken: string }
  | { kind: 'error'; message: string };

export function linkErrorMessage(reason: string): string {
  return /expired|invalid/i.test(reason)
    ? 'That email link has expired or was already used. If you were resetting your password, tap “Forgot password?” for a new one.'
    : reason;
}

function readAuthLink(): AuthLink | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const error = params.get('error_description') ?? params.get('error');
  if (!(accessToken && refreshToken) && !error) return null;

  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  if (accessToken && refreshToken) {
    return { kind: 'session', type: params.get('type') ?? '', accessToken, refreshToken };
  }
  return { kind: 'error', message: linkErrorMessage(error ?? '') };
}

export const authLink = readAuthLink();
