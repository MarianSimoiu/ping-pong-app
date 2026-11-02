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

// Supabase's default minimum; a stricter project setting comes back as an error.
const MIN_PASSWORD_LENGTH = 6;

// Shown after a password-reset link signed the player in, before the app.
export function NewPasswordScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { session, setNewPassword, skipNewPassword } = useAuth();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== repeat) {
      setError('The two passwords don’t match.');
      return;
    }
    setBusy(true);
    try {
      await setNewPassword(password);
      showAlert('Password changed', 'You’re signed in. Use your new password next time.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t change your password');
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Choose a new password</Text>
        <Text style={styles.subtitle}>For {session?.user.email}</Text>

        <TextInput
          style={styles.input}
          placeholder="New password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          autoComplete="new-password"
          value={password}
          onChangeText={setPassword}
        />
        <TextInput
          style={styles.input}
          placeholder="Repeat new password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          autoComplete="new-password"
          value={repeat}
          onChangeText={setRepeat}
          onSubmitEditing={save}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={save} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={colors.primaryText} />
          ) : (
            <Text style={styles.buttonText}>Save new password</Text>
          )}
        </Pressable>

        <Pressable onPress={skipNewPassword} disabled={busy}>
          <Text style={styles.link}>Not now</Text>
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
    title: { fontSize: 24, fontWeight: '700', color: colors.text, textAlign: 'center' },
    subtitle: {
      fontSize: 15,
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
    link: { color: colors.primary, textAlign: 'center', marginTop: spacing.md, fontSize: 14 },
    error: { color: colors.danger, marginBottom: spacing.sm, fontSize: 14 },
  });
}
