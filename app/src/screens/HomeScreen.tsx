import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AwaitingOpponentList } from '@/components/AwaitingOpponentList';
import { ChallengesCard, useChallenges } from '@/components/Challenges';
import { DoublesMatchCard, useDoublesConfirm } from '@/components/DoublesMatchCard';
import { PendingMatchCard, useMatchConfirm } from '@/components/PendingMatchCard';
import { useAuth } from '@/context/AuthContext';
import { pickHomeTip } from '@/lib/commentary';
import { MIN_MATCHES_FOR_LEADERBOARD } from '@/lib/constants';
import { fetchDoublesToConfirm, type DoublesPendingMatch } from '@/lib/doubles';
import { fetchLeaderboard } from '@/lib/leaderboard';
import { fetchPendingConfirmations, fetchSubmittedPending } from '@/lib/matches';
import { fetchMyProfile } from '@/lib/players';
import type { PendingMatch, PlayerWithRating, SubmittedPendingMatch } from '@/lib/types';
import type { HomeStackScreenProps } from '@/navigation/types';
import { radius, spacing, useTheme, type Colors } from '@/theme';

export function HomeScreen({ navigation }: HomeStackScreenProps<'Home'>) {
  const { colors, scheme, setDarkMode } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { session } = useAuth();
  const [profile, setProfile] = useState<PlayerWithRating | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingMatch[]>([]);
  const [submittedPending, setSubmittedPending] = useState<SubmittedPendingMatch[]>([]);
  const [doublesToConfirm, setDoublesToConfirm] = useState<DoublesPendingMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Picked once per mount so it doesn't change mid-view, but varies on revisit.
  const [homeTip] = useState(() => pickHomeTip());
  const challenges = useChallenges();
  const { load: loadChallenges } = challenges;

  const load = useCallback(async () => {
    if (!session) return;
    try {
      setError(null);
      const p = await fetchMyProfile(session.user.id);
      setProfile(p);
      if (p) {
        const [leaderboard, toConfirm, submitted, doubles] = await Promise.all([
          fetchLeaderboard(),
          fetchPendingConfirmations(p.id),
          fetchSubmittedPending(p.id),
          fetchDoublesToConfirm(p.id),
          loadChallenges(p.id),
        ]);
        setRank(leaderboard.find((entry) => entry.playerId === p.id)?.rank ?? null);
        setPending(toConfirm);
        setSubmittedPending(submitted);
        setDoublesToConfirm(doubles);
      } else {
        setRank(null);
        setPending([]);
        setSubmittedPending([]);
        setDoublesToConfirm([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [session, loadChallenges]);

  const singles = useMatchConfirm(load);
  const doubles = useDoublesConfirm(load);

  // Reload whenever the screen regains focus (e.g. after recording a match).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const rating = profile?.rating;
  // Challenge opponents with a challenge match waiting to be confirmed.
  const waitingWith = useMemo(
    () =>
      new Set([
        ...pending.filter((m) => m.challenge).map((m) => m.submitterId),
        ...submittedPending.filter((m) => m.challenge).map((m) => m.opponentId),
      ]),
    [pending, submittedPending],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.text} />}
      >
        <View style={styles.greetingRow}>
          <Text style={styles.greeting}>
            Hi, {profile?.display_name ?? '…'} 👋
          </Text>
          <Pressable
            style={styles.themeToggle}
            onPress={() => setDarkMode(scheme !== 'dark')}
            hitSlop={8}
          >
            <Text style={styles.themeToggleIcon}>{scheme === 'dark' ? '🌙' : '☀️'}</Text>
          </Pressable>
        </View>

        {loading && !profile ? (
          <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xl }} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <View style={styles.ratingCard}>
            <View style={styles.ratingLabelRow}>
              <Text style={styles.ratingLabel}>Skill rating</Text>
              <Pressable onPress={() => navigation.navigate('HowRatingsWork')} hitSlop={8}>
                <Text style={styles.infoIcon}>ⓘ</Text>
              </Pressable>
            </View>
            <Text style={styles.ratingValue}>{Math.round(rating?.rating ?? 1500)}</Text>
            <Text style={styles.ratingMeta}>
              ± {Math.round(rating?.rd ?? 350)} · {rating?.matches_played ?? 0} matches
            </Text>
            <Text style={styles.ratingRank}>
              {rank
                ? `Rank #${rank} on the leaderboard`
                : `Not ranked yet — needs ${MIN_MATCHES_FOR_LEADERBOARD} matches`}
            </Text>

            <View style={styles.legendCard}>
              <Text style={styles.legendText}>
                <Text style={styles.legendBold}>Rating</Text> is your skill score — everyone
                starts at 1500, and it moves after every match.{' '}
                <Text style={styles.legendBold}>±RD</Text> shows how sure we are of that number;
                lower means more settled. <Text style={styles.legendBold}>Rank</Text> is your
                position among players with at least {MIN_MATCHES_FOR_LEADERBOARD} matches, on
                the Leaderboard tab.
              </Text>
              <Pressable onPress={() => navigation.navigate('HowRatingsWork')} hitSlop={8}>
                <Text style={styles.legendLink}>How ratings work →</Text>
              </Pressable>
            </View>
          </View>
        )}

        {pending.length + doublesToConfirm.length > 0 && (
          <View style={styles.pendingSection}>
            <Text style={styles.pendingHeader}>Awaiting your confirmation</Text>
            {pending.map((m) => (
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
          </View>
        )}

        <Pressable style={styles.cta} onPress={() => navigation.navigate('SubmitMatch')}>
          <Text style={styles.ctaText}>+ Record a match</Text>
        </Pressable>

        <ChallengesCard
          c={challenges}
          waitingWith={waitingWith}
          onRecord={(opponentId) => navigation.navigate('SubmitMatch', { opponentId })}
          onHowItWorks={() => navigation.navigate('HowRatingsWork')}
        />

        <AwaitingOpponentList matches={submittedPending} style={styles.pendingSection} />

        <View style={styles.hintCard}>
          <Text style={styles.hintTitle}>From the booth 🎙️</Text>
          <Text style={styles.hintText}>{homeTip}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg },
    greetingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.lg,
    },
    greeting: { fontSize: 24, fontWeight: '700', color: colors.text },
    themeToggle: {
      width: 32,
      height: 32,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    themeToggleIcon: { fontSize: 15 },
    ratingCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    ratingLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    ratingLabel: { color: colors.textMuted, fontSize: 14 },
    infoIcon: { color: colors.textMuted, fontSize: 13 },
    ratingValue: { color: colors.primary, fontSize: 56, fontWeight: '800', marginVertical: spacing.xs },
    ratingMeta: { color: colors.textMuted, fontSize: 13 },
    ratingRank: { color: colors.primary, fontSize: 13, fontWeight: '600', marginTop: spacing.xs },
    legendCard: {
      alignSelf: 'stretch',
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      padding: spacing.md,
      marginTop: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    legendText: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
    legendBold: { color: colors.text, fontWeight: '700' },
    legendLink: { color: colors.primary, fontSize: 12, fontWeight: '700', marginTop: spacing.sm },
    cta: {
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginTop: spacing.lg,
    },
    ctaText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
    pendingSection: { marginTop: spacing.lg },
    pendingHeader: {
      color: colors.textMuted,
      fontSize: 13,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: spacing.sm,
    },
    hintCard: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      padding: spacing.md,
      marginTop: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    hintTitle: { color: colors.text, fontWeight: '600', marginBottom: spacing.xs },
    hintText: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
    error: { color: colors.danger, marginTop: spacing.lg },
  });
}
