import type { Session } from '@supabase/supabase-js';
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { Platform } from 'react-native';

import { authLink, linkErrorMessage } from '@/lib/authLink';
import { DEMO } from '@/lib/env';
import { DEMO_ME } from '@/lib/demo';
import { syncPush, turnOffPush } from '@/lib/push';
import { supabase } from '@/lib/supabase';

export type SignUpResult = { needsEmailConfirmation: boolean };

type AuthContextValue = {
  session: Session | null;
  initializing: boolean;
  // Signed in from a password-reset email: the app asks for a new password
  // before anything else.
  recovering: boolean;
  // Why an email link that opened the app didn't work (e.g. it expired).
  linkError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  setNewPassword: (password: string) => Promise<void>;
  skipNewPassword: () => void;
  dismissLinkError: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// A stand-in session for DEMO mode so the app renders the signed-in experience.
const demoSession = {
  user: { id: DEMO_ME, email: 'you@demo.app' },
} as unknown as Session;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(DEMO ? demoSession : null);
  const [initializing, setInitializing] = useState(!DEMO);
  const [recovering, setRecovering] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    if (DEMO) return;
    let active = true;

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'SIGNED_OUT') setRecovering(false);
    });

    (async () => {
      // An email link opened the app (lib/authLink.ts): sign in with the
      // session it carried. A password-reset link then asks for a new password.
      if (authLink?.kind === 'session') {
        const { error } = await supabase.auth.setSession({
          access_token: authLink.accessToken,
          refresh_token: authLink.refreshToken,
        });
        if (!active) return;
        if (error) setLinkError(linkErrorMessage(error.message));
        else if (authLink.type === 'recovery') setRecovering(true);
      } else if (authLink?.kind === 'error') {
        setLinkError(authLink.message);
      }
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session);
      setInitializing(false);
    })();

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Keeps this device's push notifications with whoever is signed in.
  const userId = session?.user.id;
  useEffect(() => {
    if (userId) syncPush(userId);
  }, [userId]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      initializing,
      recovering,
      linkError,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      async signUp(email, password, displayName) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName } },
        });
        if (error) throw error;
        // Supabase only returns an active session immediately when the
        // project's "Confirm email" setting is off (or auto-confirmed the
        // user some other way). No session yet means they must click the
        // link in a confirmation email before they can sign in.
        return { needsEmailConfirmation: !data.session };
      },
      async signOut() {
        // This device stops getting the player's notifications (a shared
        // phone shouldn't keep receiving them).
        await turnOffPush().catch(() => {});
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      },
      async sendPasswordReset(email) {
        if (DEMO) return;
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          // The emailed link opens this app again. Supabase only allows
          // addresses listed under Authentication → URL Configuration.
          redirectTo: Platform.OS === 'web' ? window.location.origin : undefined,
        });
        if (error) throw error;
      },
      async setNewPassword(password) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setRecovering(false);
      },
      skipNewPassword() {
        setRecovering(false);
      },
      dismissLinkError() {
        setLinkError(null);
      },
    }),
    [session, initializing, recovering, linkError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
