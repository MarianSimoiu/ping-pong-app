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
import { colors, radius, spacing } from '@/theme';

export function SignInScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignUp = mode === 'signUp';

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (isSignUp) {
        await signUp(email.trim(), password, displayName.trim() || email.split('@')[0]);
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
      <StatusBar style="light" />
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

        <Pressable onPress={() => setMode(isSignUp ? 'signIn' : 'signUp')}>
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
  error: { color: colors.danger, marginBottom: spacing.sm, fontSize: 14 },
});
