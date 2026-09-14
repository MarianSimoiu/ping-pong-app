import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
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
import { colors, radius, spacing, statusBarStyle } from '@/theme';

export function SignInScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A persistent (not just a one-time alert) success message — e.g. "check
  // your email" — that stays visible after signing up so it isn't missed.
  const [notice, setNotice] = useState<string | null>(null);

  const isSignUp = mode === 'signUp';

  function switchMode(next: 'signIn' | 'signUp') {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function submit() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (isSignUp) {
        const { needsEmailConfirmation } = await signUp(
          email.trim(),
          password,
          displayName.trim() || email.split('@')[0],
        );
        if (needsEmailConfirmation) {
          const message =
            `We sent a confirmation link to ${email.trim()}. Click it, then come back ` +
            'here and sign in.';
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
        <Text style={styles.subtitle}>
          {isSignUp ? 'Create your account' : 'Welcome back'}
        </Text>

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

        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {isSignUp && (
          <Text style={styles.hint}>
            Depending on how this app is set up, you may need to confirm your
            email (check your inbox) before you can sign in.
          </Text>
        )}

        {notice && <Text style={styles.notice}>{notice}</Text>}
        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={submit}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.primaryText} />
          ) : (
            <Text style={styles.buttonText}>{isSignUp ? 'Sign up' : 'Sign in'}</Text>
          )}
        </Pressable>

        <Pressable onPress={() => switchMode(isSignUp ? 'signIn' : 'signUp')}>
          <Text style={styles.switch}>
            {isSignUp
              ? 'Already have an account? Sign in'
              : "New here? Create an account"}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
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
