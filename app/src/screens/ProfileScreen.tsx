import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/context/AuthContext';
import { colors, radius, spacing } from '@/theme';

export function ProfileScreen() {
  const { session, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut();
    } catch (e) {
      Alert.alert('Sign out failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.content}>
        <Text style={styles.title}>Profile</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Signed in as</Text>
          <Text style={styles.value}>{session?.user.email}</Text>
        </View>

        <Text style={styles.note}>
          Match history and your rating-over-time chart arrive in Phase 3.
        </Text>

        <Pressable
          style={[styles.signOut, busy && { opacity: 0.6 }]}
          onPress={handleSignOut}
          disabled={busy}
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: spacing.lg },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { color: colors.textMuted, fontSize: 13 },
  value: { color: colors.text, fontSize: 16, marginTop: spacing.xs },
  note: { color: colors.textMuted, fontSize: 14, marginTop: spacing.lg, lineHeight: 20 },
  signOut: {
    marginTop: 'auto',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  signOutText: { color: colors.danger, fontSize: 16, fontWeight: '600' },
});
