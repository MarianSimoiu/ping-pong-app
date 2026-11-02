import { StatusBar } from 'expo-status-bar';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '@/context/AuthContext';
import { showAlert } from '@/lib/platformAlert';
import { radius, spacing, useTheme, type Colors } from '@/theme';

type Mode = 'signIn' | 'signUp' | 'reset';

const SUBTITLES: Record<Mode, string> = {
  signIn: 'Welcome back',
  signUp: 'Create your account',
  reset: 'Reset your password',
};

const BUTTONS: Record<Mode, string> = {
  signIn: 'Sign in',
  signUp: 'Sign up',
  reset: 'Send reset link',
};

export function SignInScreen() {
  const { colors, statusBarStyle } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { signIn, signUp, sendPasswordReset, linkError, dismissLinkError } = useAuth();
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A persistent (not just a one-time alert) success message — e.g. "check
  // your email" — that stays visible after signing up so it isn't missed.
  const [notice, setNotice] = useState<string | null>(null);

  const isSignUp = mode === 'signUp';
  const isReset = mode === 'reset';
  // An email link that didn't work (expired, already used) explains itself here.
  const shownError = error ?? linkError;

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
    dismissLinkError();
  }

  async function submit() {
    setError(null);
    setNotice(null);
    dismissLinkError();
    if (isReset && !email.trim()) {
      setError('Enter your email first.');
      return;
    }
    setBusy(true);
    try {
      if (isReset) {
        await sendPasswordReset(email.trim());
        setNotice(
          `If ${email.trim()} has an account, we've sent it a link to choose a new password. ` +
            'It can take a minute; check your spam folder too. The link works once.',
        );
      } else if (isSignUp) {
        const { needsEmailConfirmation } = await signUp(
          email.trim(),
          password,
          displayName.trim() || email.split('@')[0],
        );
        if (needsEmailConfirmation) {
          const message =
            `We sent a confirmation link to ${email.trim()}. Open it to finish signing up: ` +
            'it brings you back here, signed in. Check your spam folder if it doesn’t arrive ' +
            'within a minute.';
          showAlert('Check your email', message);
          setNotice(message);
          setMode('signIn');
          setPassword('');
        }
        // If a session came back immediately, no message needed — the app
        // will switch to the signed-in view on its own.
      } else {
        await signIn(email.trim(), password);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style={statusBarStyle} />
      <View style={styles.card}>
        <Text style={styles.title}>🏓 Ping Pong</Text>
        <Text style={styles.subtitle}>{SUBTITLES[mode]}</Text>

        {isSignUp && (
          <TextInput
            style={styles.input}
            placeholder="Display name"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
            value={displayName}
            onChangeText={setDisplayName}
          />
        )}

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />

        {!isReset && (
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
        )}

        {mode === 'signIn' && (
          <Pressable onPress={() => switchMode('reset')} style={styles.forgot} hitSlop={8}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </Pressable>
        )}

        {isSignUp && (
          <Text style={styles.hint}>
            You'll get an email to confirm your address before you can sign in.
          </Text>
        )}

        {isReset && (
          <Text style={styles.hint}>
            Enter your account's email and we'll send you a link to choose a new password.
          </Text>
        )}

        {notice && <Text style={styles.notice}>{notice}</Text>}
        {shownError && <Text style={styles.error}>{shownError}</Text>}

        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={submit}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.primaryText} />
          ) : (
            <Text style={styles.buttonText}>{BUTTONS[mode]}</Text>
          )}
        </Pressable>

        <Pressable onPress={() => switchMode(mode === 'signIn' ? 'signUp' : 'signIn')}>
          <Text style={styles.switch}>
            {mode === 'signIn'
              ? 'New here? Create an account'
              : isSignUp
                ? 'Already have an account? Sign in'
                : 'Back to sign in'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      justifyContent: 'center',
      padding: spacing.lg,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    title: { fontSize: 32, fontWeight: '700', color: colors.text, textAlign: 'center' },
    subtitle: {
      fontSize: 16,
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: spacing.xs,
      marginBottom: spacing.lg,
    },
    input: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      color: colors.text,
      fontSize: 16,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    button: {
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
    forgot: { alignSelf: 'flex-end', marginBottom: spacing.sm },
    forgotText: { color: colors.primary, fontSize: 13 },
    switch: {
      color: colors.primary,
      textAlign: 'center',
      marginTop: spacing.md,
      fontSize: 14,
    },
    hint: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
      marginBottom: spacing.sm,
    },
    notice: {
      color: colors.success,
      marginBottom: spacing.sm,
      fontSize: 14,
      lineHeight: 20,
    },
    error: { color: colors.danger, marginBottom: spacing.sm, fontSize: 14 },
  });
}
