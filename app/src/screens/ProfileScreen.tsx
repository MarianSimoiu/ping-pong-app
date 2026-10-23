import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AwaitingOpponentList } from '@/components/AwaitingOpponentList';
import { Avatar } from '@/components/Avatar';
import { useAuth } from '@/context/AuthContext';
import { uploadAvatar } from '@/lib/avatar';
import { openInstall, useInstall } from '@/lib/install';
import { fetchSubmittedPending } from '@/lib/matches';
import { fetchMyProfile } from '@/lib/players';
import { showAlert } from '@/lib/platformAlert';
import type { SubmittedPendingMatch } from '@/lib/types';
import type { ProfileStackScreenProps } from '@/navigation/types';
import { radius, spacing, useTheme, type Colors } from '@/theme';

type Me = { id: string; displayName: string; avatarUrl: string | null };

export function ProfileScreen({ navigation }: ProfileStackScreenProps<'Account'>) {
  const { colors, scheme, setDarkMode } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { session, signOut } = useAuth();
  const install = useInstall();
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [submittedPending, setSubmittedPending] = useState<SubmittedPendingMatch[]>([]);

  const loadMe = useCallback(async () => {
    if (!session) return;
    try {
      const p = await fetchMyProfile(session.user.id);
      if (p) {
        setMe({ id: p.id, displayName: p.display_name, avatarUrl: p.avatar_url });
        setSubmittedPending(await fetchSubmittedPending(p.id));
      }
    } catch {
      // Non-fatal: the stats shortcut / pending list just won't be available.
    }
  }, [session]);

  // Refresh whenever the screen regains focus (e.g. after submitting a
  // match), so a just-recorded one shows up here without a manual reload.
  useFocusEffect(
    useCallback(() => {
      loadMe();
    }, [loadMe]),
  );

  async function handleChangePhoto() {
    if (!session || !me) return;

    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showAlert('Permission needed', 'Allow photo access to set a profile picture.');
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (result.canceled) return;

    const localUri = result.assets[0].uri;
    const previousUrl = me.avatarUrl;
    setMe({ ...me, avatarUrl: localUri });

    try {
      const finalUrl = await uploadAvatar(session.user.id, localUri);
      setMe((current) => (current ? { ...current, avatarUrl: finalUrl } : current));
    } catch (e) {
      setMe((current) => (current ? { ...current, avatarUrl: previousUrl } : current));
      showAlert('Upload failed', e instanceof Error ? e.message : 'Could not save your photo');
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Profile</Text>

        <View style={styles.avatarSection}>
          <Avatar uri={me?.avatarUrl} name={me?.displayName ?? '?'} size={80} />
          <Pressable style={styles.photoButton} onPress={handleChangePhoto}>
            <Text style={styles.photoButtonText}>
              {me?.avatarUrl ? 'Change photo' : 'Add photo'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Signed in as</Text>
          <Text style={styles.value}>{session?.user.email}</Text>
        </View>

        <AwaitingOpponentList matches={submittedPending} style={styles.pendingSection} />

        <View style={[styles.card, styles.darkModeRow]}>
          <Text style={styles.value}>Dark mode</Text>
          <Switch
            value={scheme === 'dark'}
            onValueChange={setDarkMode}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.surface}
          />
        </View>

        {me && (
          <Pressable
            style={styles.linkCard}
            onPress={() =>
              navigation.navigate('PlayerProfile', { playerId: me.id, displayName: me.displayName })
            }
          >
            <Text style={styles.linkCardText}>View my stats & rating history →</Text>
          </Pressable>
        )}

        <Pressable style={styles.linkCard} onPress={() => navigation.navigate('HowRatingsWork')}>
          <Text style={styles.linkCardText}>How ratings work →</Text>
        </Pressable>

        {/* Only while the app is open in a browser that can install it. */}
        {install.method && (
          <Pressable style={styles.linkCard} onPress={openInstall}>
            <Text style={styles.linkCardText}>📲 Install Ping Pong on this device</Text>
          </Pressable>
        )}

        {/* Pushes Sign out to the bottom on a short page, and keeps a gap
            above it once the page is taller than the screen and scrolls. */}
        <View style={styles.spacer} />

        <Pressable
          style={[styles.signOut, busy && { opacity: 0.6 }]}
          onPress={handleSignOut}
          disabled={busy}
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { flexGrow: 1, padding: spacing.lg },
    title: { fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: spacing.lg },
    avatarSection: { alignItems: 'center', marginBottom: spacing.lg },
    photoButton: { marginTop: spacing.sm },
    photoButtonText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    label: { color: colors.textMuted, fontSize: 13 },
    value: { color: colors.text, fontSize: 16, marginTop: spacing.xs },
    pendingSection: { marginTop: spacing.md },
    darkModeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.md,
    },
    linkCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.md,
      marginTop: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    linkCardText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
    spacer: { flexGrow: 1, minHeight: spacing.lg },
    signOut: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    signOutText: { color: colors.danger, fontSize: 16, fontWeight: '600' },
  });
}
