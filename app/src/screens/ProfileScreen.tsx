import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AwaitingOpponentList } from '@/components/AwaitingOpponentList';
import { Avatar } from '@/components/Avatar';
import { DoublesMatchCard, useDoublesConfirm } from '@/components/DoublesMatchCard';
import { MatchHistoryList } from '@/components/MatchHistoryList';
import { PendingMatchCard, useMatchConfirm } from '@/components/PendingMatchCard';
import { RatingChart } from '@/components/RatingChart';
import { SegmentedTabs } from '@/components/SegmentedTabs';
import { StatsRow } from '@/components/StatsRow';
import { TierCard } from '@/components/TierCard';
import { TrophyCabinet } from '@/components/TrophyCabinet';
import { useBadge } from '@/context/BadgesContext';
import { useAuth } from '@/context/AuthContext';
import { uploadAvatar } from '@/lib/avatar';
import { MIN_MATCHES_FOR_LEADERBOARD } from '@/lib/constants';
import { fetchDoublesAwaitingOpponents, fetchDoublesToConfirm, type DoublesPendingMatch } from '@/lib/doubles';
import { openInstall, useInstall } from '@/lib/install';
import {
  fetchMatchHistory,
  fetchPlayerSeasonPoints,
  fetchRatingHistory,
  fetchRecord,
  type HistoryPoint,
  type MatchHistoryItem,
} from '@/lib/leaderboard';
import { fetchPendingConfirmations, fetchSubmittedPending } from '@/lib/matches';
import { fetchMyProfile } from '@/lib/players';
import { showAlert } from '@/lib/platformAlert';
import { getPushStatus, turnOffPush, turnOnPush, type PushStatus } from '@/lib/push';
import type { PendingMatch, SubmittedPendingMatch } from '@/lib/types';
import type { ProfileStackScreenProps } from '@/navigation/types';
import { radius, spacing, useTheme, type Colors } from '@/theme';

type Me = { id: string; displayName: string; avatarUrl: string | null; rating: number; rd: number; matchesPlayed: number };

// Your stats, your match history, the matches waiting on someone's answer, and
// your titles and trophies (Awards).
type Tab = 'stats' | 'history' | 'pending' | 'awards';

const PUSH_HINTS: Record<PushStatus, string> = {
  on: 'You’ll be notified about matches to confirm, and when yours are confirmed or declined.',
  off: 'Get notified about matches to confirm, and when yours are confirmed or declined.',
  blocked: 'Blocked for this app. Allow notifications in your browser or phone settings, then come back.',
  'needs-install': 'On iPhone and iPad, add the app to your Home Screen first, then turn this on from there.',
  unsupported: 'This browser can’t show notifications.',
};

export function ProfileScreen({ navigation }: ProfileStackScreenProps<'Account'>) {
  const { colors, scheme, setDarkMode } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { session, signOut } = useAuth();
  const install = useInstall();
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const myBadge = useBadge(me?.id);
  const [ratingHistory, setRatingHistory] = useState<HistoryPoint[]>([]);
  const [matches, setMatches] = useState<MatchHistoryItem[]>([]);
  const [record, setRecord] = useState({ wins: 0, losses: 0 });
  const [seasonPoints, setSeasonPoints] = useState(0);
  const [toConfirm, setToConfirm] = useState<PendingMatch[]>([]);
  const [doublesToConfirm, setDoublesToConfirm] = useState<DoublesPendingMatch[]>([]);
  const [submittedPending, setSubmittedPending] = useState<SubmittedPendingMatch[]>([]);
  const [doublesAwaiting, setDoublesAwaiting] = useState<DoublesPendingMatch[]>([]);
  // Until you pick one: Pending while something waits on your answer, else Stats.
  const [tab, setTab] = useState<Tab | null>(null);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  const loadMe = useCallback(async () => {
    if (!session) return;
    try {
      const p = await fetchMyProfile(session.user.id);
      if (p) {
        setMe({
          id: p.id,
          displayName: p.display_name,
          avatarUrl: p.avatar_url,
          rating: p.rating?.rating ?? 1500,
          rd: p.rating?.rd ?? 350,
          matchesPlayed: p.rating?.matches_played ?? 0,
        });
        // Each on its own: one that fails leaves its tab as it was.
        const into = <T,>(load: Promise<T>, set: (value: T) => void) => load.then(set, () => {});
        await Promise.all([
          into(fetchRatingHistory(p.id), setRatingHistory),
          into(fetchMatchHistory(p.id), setMatches),
          into(fetchRecord(p.id), setRecord),
          into(fetchPlayerSeasonPoints(p.id), setSeasonPoints),
          into(fetchPendingConfirmations(p.id), setToConfirm),
          into(fetchDoublesToConfirm(p.id), setDoublesToConfirm),
          into(fetchSubmittedPending(p.id), setSubmittedPending),
          into(fetchDoublesAwaitingOpponents(p.id), setDoublesAwaiting),
        ]);
      }
    } catch {
      // Non-fatal: the tabs just stay empty.
    }
  }, [session]);

  // Confirming or declining reloads everything: a confirmed match moves your
  // rating, record and history too.
  const singles = useMatchConfirm(loadMe);
  const doubles = useDoublesConfirm(loadMe);

  // Refresh whenever the screen regains focus (e.g. after submitting a
  // match), so a just-recorded one shows up here without a manual reload.
  useFocusEffect(
    useCallback(() => {
      loadMe();
      // Also catches a permission changed in the phone's settings meanwhile.
      getPushStatus().then(setPush, () => setPush('unsupported'));
    }, [loadMe]),
  );

  const toAnswer = toConfirm.length + doublesToConfirm.length;
  const pendingCount = toAnswer + submittedPending.length + doublesAwaiting.length;
  const shownTab: Tab = tab ?? (toAnswer > 0 ? 'pending' : 'stats');

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
          <Avatar uri={me?.avatarUrl} name={me?.displayName ?? '?'} size={88} playerId={me?.id} />
          {myBadge?.titleLabel && <Text style={styles.titleLabel}>{myBadge.titleLabel}</Text>}
          <Pressable style={styles.photoButton} onPress={handleChangePhoto}>
            <Text style={styles.photoButtonText}>
              {me?.avatarUrl ? 'Change photo' : 'Add photo'}
            </Text>
          </Pressable>
        </View>

        {me && <TierCard playerId={me.id} rating={me.rating} matchesPlayed={me.matchesPlayed} isMe />}

        {me && (
          <>
            <View style={styles.tabsTop} />
            <SegmentedTabs
              items={[
                { key: 'stats', label: 'Stats' },
                { key: 'history', label: 'History' },
                { key: 'pending', label: 'Pending', count: pendingCount, alert: toAnswer > 0 },
                { key: 'awards', label: 'Awards' },
              ]}
              active={shownTab}
              onChange={setTab}
            />
            {shownTab === 'stats' ? (
              <>
                <StatsRow
                  rating={me.rating}
                  rd={me.rd}
                  wins={record.wins}
                  losses={record.losses}
                  seasonPoints={seasonPoints}
                  onInfoPress={() => navigation.navigate('HowRatingsWork')}
                />
                {me.matchesPlayed < MIN_MATCHES_FOR_LEADERBOARD && (
                  <Text style={styles.note}>
                    Not ranked yet — players join the leaderboard after {MIN_MATCHES_FOR_LEADERBOARD} matches.
                  </Text>
                )}
                <Text style={styles.listLabel}>Rating over time</Text>
                <RatingChart points={ratingHistory} />
              </>
            ) : shownTab === 'history' ? (
              <MatchHistoryList matches={matches} />
            ) : shownTab === 'awards' ? (
              <TrophyCabinet playerId={me.id} isMe heading={false} />
            ) : pendingCount === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyEmoji}>⏳</Text>
                <Text style={styles.emptyTitle}>Nothing pending</Text>
                <Text style={styles.emptyText}>
                  Matches recorded against you wait here for your answer, and the ones you record wait here
                  until your opponent confirms them.
                </Text>
              </View>
            ) : (
              <>
                {toAnswer > 0 && <Text style={styles.listLabel}>Awaiting your confirmation</Text>}
                {toConfirm.map((m) => (
                  <PendingMatchCard
                    key={m.matchId}
                    match={m}
                    busy={singles.actingId === m.matchId}
                    onConfirm={() => singles.act(m, 'confirm')}
                    onDecline={() => singles.act(m, 'decline')}
                  />
                ))}
                {doublesToConfirm.map((m) => (
                  <DoublesMatchCard
                    key={m.matchId}
                    match={m}
                    busy={doubles.actingId === m.matchId}
                    onConfirm={() => doubles.act(m, 'confirm')}
                    onDecline={() => doubles.act(m, 'decline')}
                  />
                ))}
                {submittedPending.length + doublesAwaiting.length > 0 && (
                  <Text style={styles.listLabel}>Awaiting opponents’ confirmation</Text>
                )}
                <AwaitingOpponentList matches={submittedPending} label={null} />
                {doublesAwaiting.map((m) => (
                  <DoublesMatchCard key={m.matchId} match={m} />
                ))}
              </>
            )}
          </>
        )}


        <View style={styles.card}>
          <Text style={styles.label}>Signed in as</Text>
          <Text style={styles.value}>{session?.user.email}</Text>
        </View>

        <View style={[styles.card, styles.toggleRow]}>
          <Text style={styles.value}>Dark mode</Text>
          <Switch
            value={scheme === 'dark'}
            onValueChange={setDarkMode}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.surface}
          />
        </View>

        {/* Web only: the installed app and the browser get Web Push. */}
        {Platform.OS === 'web' && push && (
          <View style={[styles.card, styles.toggleRow]}>
            <View style={styles.toggleText}>
              <Text style={styles.value}>Notifications</Text>
              <Text style={styles.toggleHint}>{PUSH_HINTS[push]}</Text>
            </View>
            <Switch
              value={push === 'on'}
              onValueChange={handlePushToggle}
              disabled={pushBusy || (push !== 'on' && push !== 'off')}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.surface}
              accessibilityLabel="Notifications"
            />
          </View>
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
    titleLabel: { color: colors.textMuted, fontSize: 14, fontStyle: 'italic', marginTop: spacing.xs },
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
    tabsTop: { height: spacing.lg },
    listLabel: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    note: { color: colors.textMuted, fontSize: 13, marginTop: spacing.sm },
    empty: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: spacing.xs,
    },
    emptyEmoji: { fontSize: 36, opacity: 0.35 },
    emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
    emptyText: { color: colors.textMuted, fontSize: 13, lineHeight: 18, textAlign: 'center' },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.md,
    },
    toggleText: { flex: 1, marginRight: spacing.md },
    toggleHint: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: spacing.xs },
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
