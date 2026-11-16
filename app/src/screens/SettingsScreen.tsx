import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/context/AuthContext';
import { openInstall, useInstall } from '@/lib/install';
import { showAlert } from '@/lib/platformAlert';
import { getPushStatus, turnOffPush, turnOnPush, type PushStatus } from '@/lib/push';
import type { ProfileStackScreenProps } from '@/navigation/types';
import { radius, spacing, useTheme, type Colors } from '@/theme';

const PUSH_HINTS: Record<PushStatus, string> = {
  on: 'You’ll be notified about matches to confirm, and when yours are confirmed or declined.',
  off: 'Get notified about matches to confirm, and when yours are confirmed or declined.',
  blocked: 'Blocked for this app. Allow notifications in your browser or phone settings, then come back.',
  'needs-install': 'On iPhone and iPad, add the app to your Home Screen first, then turn this on from there.',
  unsupported: 'This browser can’t show notifications.',
};

// Profile → Settings, the one place for these: who you're signed in as, dark
// mode, notifications, how ratings work (and installing the app, where the
// browser can), and signing out.
export function SettingsScreen({ navigation }: ProfileStackScreenProps<'Settings'>) {
  const { colors, scheme, setDarkMode } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { session, signOut } = useAuth();
  const install = useInstall();
  const [busy, setBusy] = useState(false);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  // On every visit: also catches a permission changed in the phone's settings meanwhile.
  useFocusEffect(
    useCallback(() => {
      getPushStatus().then(setPush, () => setPush('unsupported'));
    }, []),
  );

  async function handlePushToggle(on: boolean) {
    if (!session) return;
    setPushBusy(true);
    try {
      const next = on ? await turnOnPush(session.user.id) : await turnOffPush();
      setPush(next);
      if (on && next === 'blocked') {
        showAlert('Notifications blocked', 'You can allow them for this app in your browser or phone settings.');
      }
    } catch (e) {
      showAlert(
        on ? 'Couldn’t turn on notifications' : 'Couldn’t turn off notifications',
        e instanceof Error ? e.message : 'Something went wrong',
      );
      setPush(await getPushStatus().catch(() => 'off' as const));
    } finally {
      setPushBusy(false);
    }
  }

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

  const switchColors = { trackColor: { false: colors.border, true: colors.primary }, thumbColor: colors.surface };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.groupLabel}>Account</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowHint}>Signed in as</Text>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {session?.user.email}
              </Text>
            </View>
          </View>
        </View>

        <Text style={styles.groupLabel}>App</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <Text style={[styles.rowTitle, styles.rowText]}>Dark mode</Text>
            <Switch
              value={scheme === 'dark'}
              onValueChange={setDarkMode}
              accessibilityLabel="Dark mode"
              {...switchColors}
            />
          </View>
          {/* Web only: the installed app and the browser get Web Push. */}
          {Platform.OS === 'web' && push && (
            <View style={[styles.row, styles.rowDivider]}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Notifications</Text>
                <Text style={styles.rowHint}>{PUSH_HINTS[push]}</Text>
              </View>
              <Switch
                value={push === 'on'}
                onValueChange={handlePushToggle}
                disabled={pushBusy || (push !== 'on' && push !== 'off')}
                accessibilityLabel="Notifications"
                {...switchColors}
              />
            </View>
          )}
        </View>

        <Text style={styles.groupLabel}>Help</Text>
        <View style={styles.group}>
          <Pressable style={styles.row} onPress={() => navigation.navigate('HowRatingsWork')} accessibilityRole="link">
            <Text style={[styles.rowTitle, styles.rowText]}>How ratings work</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
          {/* Only while the app is open in a browser that can install it. */}
          {install.method && (
            <Pressable style={[styles.row, styles.rowDivider]} onPress={openInstall} accessibilityRole="button">
              <Text style={[styles.rowTitle, styles.rowText]}>📲 Install Ping Pong on this device</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )}
        </View>

        <Pressable style={[styles.signOut, busy && { opacity: 0.6 }]} onPress={handleSignOut} disabled={busy}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg, paddingBottom: spacing.xl },
    groupLabel: {
      color: colors.textMuted,
      fontSize: 13,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    group: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
      minHeight: 52,
    },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    rowText: { flex: 1 },
    rowTitle: { color: colors.text, fontSize: 16 },
    rowHint: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: 2 },
    chevron: { color: colors.textMuted, fontSize: 22, lineHeight: 22 },
    signOut: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: spacing.xl,
    },
    signOutText: { color: colors.danger, fontSize: 16, fontWeight: '600' },
  });
}
