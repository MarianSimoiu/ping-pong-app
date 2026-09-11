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

import { useAuth } from '@/context/AuthContext';
import { pickDeclineLine, pickHomeTip, pickMatchResultLine } from '@/lib/commentary';
import { confirmMatch, fetchPendingConfirmations } from '@/lib/matches';
import { showAlert } from '@/lib/platformAlert';
import { fetchMyProfile } from '@/lib/players';
import type { PendingMatch, PlayerWithRating } from '@/lib/types';
import type { HomeStackScreenProps } from '@/navigation/types';
import { colors, radius, spacing } from '@/theme';

export function HomeScreen({ navigation }: HomeStackScreenProps<'Home'>) {
  const { session } = useAuth();
  const [profile, setProfile] = useState<PlayerWithRating | null>(null);
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
      setPending(p ? await fetchPendingConfirmations(p.id) : []);
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
        <Text style={styles.greeting}>
          Hi, {profile?.display_name ?? '…'} 👋
        </Text>

        {loading && !profile ? (
          <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xl }} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <View style={styles.ratingCard}>
            <Text style={styles.ratingLabel}>Skill rating (Glicko-2)</Text>
            <Text style={styles.ratingValue}>{Math.round(rating?.rating ?? 1500)}</Text>
            <Text style={styles.ratingMeta}>
              ± {Math.round(rating?.rd ?? 350)} · {rating?.matches_played ?? 0} matches
              {isProvisional ? ' · provisional' : ''}
            </Text>
          </View>
        )}

        {pending.length > 0 && (
          <View style={styles.pendingSection}>
            <Text style={styles.pendingHeader}>Awaiting your confirmation</Text>
            {pending.map((m) => (
              <View key={m.matchId} style={styles.pendingCard}>
                <Text style={styles.pendingText}>
                  {m.submitterName} logged a match: you {m.iWon ? 'won' : 'lost'} {m.myGames}–
                  {m.opponentGames}
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
  greeting: { fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: spacing.lg },
  ratingCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  ratingLabel: { color: colors.textMuted, fontSize: 14 },
  ratingValue: { color: colors.primary, fontSize: 56, fontWeight: '800', marginVertical: spacing.xs },
  ratingMeta: { color: colors.textMuted, fontSize: 13 },
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
  pendingText: { color: colors.text, fontSize: 14, marginBottom: spacing.sm },
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
