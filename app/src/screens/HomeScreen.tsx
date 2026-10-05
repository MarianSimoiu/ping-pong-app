import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
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

import { Avatar } from '@/components/Avatar';
import { useAuth } from '@/context/AuthContext';
import { pickDeclineLine, pickHomeTip, pickMatchResultLine, pickPendingLine } from '@/lib/commentary';
import { MIN_MATCHES_FOR_LEADERBOARD } from '@/lib/constants';
import { fetchLeaderboard } from '@/lib/leaderboard';
import { confirmMatch, fetchPendingConfirmations } from '@/lib/matches';
import { showAlert } from '@/lib/platformAlert';
import { fetchMyProfile } from '@/lib/players';
import type { PendingMatch, PlayerWithRating } from '@/lib/types';
import type { HomeStackScreenProps } from '@/navigation/types';
import { colors, radius, spacing } from '@/theme';

const BETA_MESSAGE =
  'This app is still early and actively evolving — expect rough edges, missing ' +
  'features, and things that might change or break between updates. That is ' +
  'expected at this stage, not a sign something is wrong.\n\n' +
  'Found a bug, have an idea, or something just feels off? Tell whoever gave you ' +
  'access. Feedback from real games is exactly what shapes what gets built next.';

const GLICKO2_EXPLANATION =
  'Glicko-2 is the system behind your Skill rating — think of it as an upgraded ' +
  'version of the Elo rating used in chess.\n\n' +
  'Everyone starts at 1500. After every match, your rating moves based on how ' +
  'surprising the result was. Beat someone much weaker than you? It barely moves — ' +
  "you were supposed to win. Lose to someone much weaker? That costs a lot, since it " +
  'means your real skill might be lower than thought. This is what keeps it fair: ' +
  'farming easy opponents just does not work.\n\n' +
  '±RD is how sure the system is about your number. It starts wide (350) and narrows ' +
  'as you play — that is why new players move fast for their first 10 matches, then ' +
  'settle down. Stop playing for a while and it creeps back up, since the system gets ' +
  'less sure about you over time.\n\n' +
  'Bottom line: play real matches, win or lose, and your rating finds its true level ' +
  'on its own.';

function formatSubmittedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function HomeScreen({ navigation }: HomeStackScreenProps<'Home'>) {
  const { session } = useAuth();
  const [profile, setProfile] = useState<PlayerWithRating | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingMatch[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Picked once per mount so it doesn't change mid-view, but varies on revisit.
  const [homeTip] = useState(() => pickHomeTip());

  const load = useCallback(async () => {
    if (!session) return;
    try {
      setError(null);
      const p = await fetchMyProfile(session.user.id);
      setProfile(p);
      if (p) {
        const leaderboard = await fetchLeaderboard();
        setRank(leaderboard.find((entry) => entry.playerId === p.id)?.rank ?? null);
        setPending(await fetchPendingConfirmations(p.id));
      } else {
        setRank(null);
        setPending([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [session]);

  const act = useCallback(
    async (match: PendingMatch, action: 'confirm' | 'decline') => {
      setActingId(match.matchId);
      try {
        const result = await confirmMatch(match.matchId, action);
        if (action === 'confirm' && result.you) {
          showAlert(
            'MATCH CALLED!',
            pickMatchResultLine({
              iWon: match.iWon,
              myGames: match.myGames,
              opponentGames: match.opponentGames,
              opponentName: match.submitterName,
              delta: result.you.delta,
            }),
          );
        } else if (action === 'decline') {
          showAlert('Waved off', pickDeclineLine());
        }
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update match');
      } finally {
        setActingId(null);
      }
    },
    [load],
  );

  // Reload whenever the screen regains focus (e.g. after recording a match).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const rating = profile?.rating;
  const isProvisional = (rating?.matches_played ?? 0) < 10;

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
            style={styles.betaBadge}
            onPress={() => showAlert('This app is in beta', BETA_MESSAGE)}
          >
            <Text style={styles.betaBadgeText}>BETA</Text>
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
              <Pressable
                onPress={() => showAlert('What is Glicko-2?', GLICKO2_EXPLANATION)}
                hitSlop={8}
              >
                <Text style={styles.infoIcon}>ⓘ</Text>
              </Pressable>
            </View>
            <Text style={styles.ratingValue}>{Math.round(rating?.rating ?? 1500)}</Text>
            <Text style={styles.ratingMeta}>
              ± {Math.round(rating?.rd ?? 350)} · {rating?.matches_played ?? 0} matches
              {isProvisional ? ' · provisional' : ''}
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
            </View>
          </View>
        )}

        {pending.length > 0 && (
          <View style={styles.pendingSection}>
            <Text style={styles.pendingHeader}>Awaiting your confirmation</Text>
            {pending.map((m) => (
              <View key={m.matchId} style={styles.pendingCard}>
                <View style={styles.pendingHeaderRow}>
                  <Avatar uri={m.submitterAvatarUrl} name={m.submitterName} size={36} />
                  <View style={styles.pendingHeaderText}>
                    <Text style={styles.pendingName}>{m.submitterName}</Text>
                    <Text style={styles.pendingTime}>{formatSubmittedAt(m.submittedAt)}</Text>
                  </View>
                </View>
                <Text style={styles.pendingText}>
                  {pickPendingLine({
                    submitterName: m.submitterName,
                    iWon: m.iWon,
                    myGames: m.myGames,
                    opponentGames: m.opponentGames,
                  })}
                </Text>
                <Text style={styles.pendingSets}>
                  Sets: {m.games.map((g) => `${g.myScore}–${g.opponentScore}`).join(', ')}
                </Text>
                <View style={styles.pendingActions}>
                  <Pressable
                    style={[styles.confirmBtn, actingId === m.matchId && { opacity: 0.5 }]}
                    onPress={() => act(m, 'confirm')}
                    disabled={actingId === m.matchId}
                  >
                    <Text style={styles.confirmText}>Confirm</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.declineBtn, actingId === m.matchId && { opacity: 0.5 }]}
                    onPress={() => act(m, 'decline')}
                    disabled={actingId === m.matchId}
                  >
                    <Text style={styles.declineText}>Decline</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        <Pressable style={styles.cta} onPress={() => navigation.navigate('SubmitMatch')}>
          <Text style={styles.ctaText}>+ Record a match</Text>
        </Pressable>

        <View style={styles.hintCard}>
          <Text style={styles.hintTitle}>From the booth 🎙️</Text>
          <Text style={styles.hintText}>{homeTip}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  greeting: { fontSize: 24, fontWeight: '700', color: colors.text },
  betaBadge: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  betaBadgeText: { color: colors.text, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
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
  pendingCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  pendingHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  pendingHeaderText: { marginLeft: spacing.sm },
  pendingName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  pendingTime: { color: colors.textMuted, fontSize: 11 },
  pendingText: { color: colors.text, fontSize: 14, marginBottom: spacing.xs },
  pendingSets: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.sm },
  pendingActions: { flexDirection: 'row', gap: spacing.sm },
  confirmBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  confirmText: { color: colors.primaryText, fontWeight: '600' },
  declineBtn: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  declineText: { color: colors.danger, fontWeight: '600' },
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
