import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/context/AuthContext';
import { fetchMyProfile } from '@/lib/players';
import { showAlert } from '@/lib/platformAlert';
import type { ProfileStackScreenProps } from '@/navigation/types';
import { colors, radius, spacing } from '@/theme';

export function ProfileScreen({ navigation }: ProfileStackScreenProps<'Account'>) {
  const { session, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<{ id: string; displayName: string } | null>(null);

  const loadMe = useCallback(async () => {
    if (!session) return;
    try {
      const p = await fetchMyProfile(session.user.id);
      if (p) setMe({ id: p.id, displayName: p.display_name });
    } catch {
      // Non-fatal: the stats shortcut just won't be available.
    }
  }, [session]);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut();
    } catch (e) {
      showAlert('Sign out failed', e instanceof Error ? e.message : 'Unknown error');
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

        {me && (
          <Pressable
            style={styles.statsLink}
            onPress={() =>
              navigation.navigate('PlayerProfile', { playerId: me.id, displayName: me.displayName })
            }
          >
            <Text style={styles.statsLinkText}>View my stats & rating history →</Text>
          </Pressable>
        )}

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
  statsLink: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statsLinkText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
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
