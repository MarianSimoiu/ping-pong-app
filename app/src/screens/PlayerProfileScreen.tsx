import { type RouteProp, useRoute } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RatingChart } from '@/components/RatingChart';
import {
  fetchMatchHistory,
  fetchPlayerById,
  fetchPlayerSeasonPoints,
  fetchRatingHistory,
  fetchRecord,
  type HistoryPoint,
  type MatchHistoryItem,
} from '@/lib/leaderboard';
import type { PlayerWithRating } from '@/lib/types';
import { colors, radius, spacing } from '@/theme';

// Shared param shape (the route exists in both the Leaderboard and Profile stacks).
type ParamList = { PlayerProfile: { playerId: string; displayName: string } };

export function PlayerProfileScreen() {
  const route = useRoute<RouteProp<ParamList, 'PlayerProfile'>>();
  const { playerId } = route.params;

  const [player, setPlayer] = useState<PlayerWithRating | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [matches, setMatches] = useState<MatchHistoryItem[]>([]);
  const [record, setRecord] = useState<{ wins: number; losses: number }>({ wins: 0, losses: 0 });
  const [seasonPoints, setSeasonPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [p, h, m, r, sp] = await Promise.all([
        fetchPlayerById(playerId),
        fetchRatingHistory(playerId),
        fetchMatchHistory(playerId),
        fetchRecord(playerId),
        fetchPlayerSeasonPoints(playerId),
      ]);
      setPlayer(p);
      setHistory(h);
      setMatches(m);
      setRecord(r);
      setSeasonPoints(sp);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  useEffect(() => {
    load();
  }, [load]);

  const rating = player?.rating;
  const isProvisional = (rating?.matches_played ?? 0) < 10;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.text} />}
      >
        {loading && !player ? (
          <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xl }} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <>
            <Text style={styles.name}>{player?.display_name}</Text>

            <View style={styles.statsRow}>
              <Stat label="Rating" value={String(Math.round(rating?.rating ?? 1500))} />
              <Stat label="±RD" value={String(Math.round(rating?.rd ?? 350))} />
              <Stat label="W–L" value={`${record.wins}–${record.losses}`} />
              <Stat label="Season" value={String(seasonPoints)} />
            </View>
            {isProvisional && (
              <Text style={styles.provisional}>
                Provisional — under 10 matches, rating still settling.
              </Text>
            )}

            <Text style={styles.section}>Rating over time</Text>
            <RatingChart points={history} />

            <Text style={styles.section}>Recent matches</Text>
            {matches.length === 0 ? (
              <Text style={styles.empty}>No matches yet.</Text>
            ) : (
              matches.map((m) => (
                <View key={m.id} style={styles.matchRow}>
                  <View style={[styles.badge, m.result === 'win' ? styles.badgeWin : styles.badgeLoss]}>
                    <Text style={styles.badgeText}>{m.result === 'win' ? 'W' : 'L'}</Text>
                  </View>
                  <Text style={styles.matchOpponent} numberOfLines={1}>
                    vs {m.opponentName}
                  </Text>
                  <Text style={[styles.matchDelta, m.delta >= 0 ? styles.deltaUp : styles.deltaDown]}>
                    {m.delta >= 0 ? '+' : ''}
                    {Math.round(m.delta)}
                  </Text>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  name: { fontSize: 26, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  statValue: { color: colors.text, fontSize: 22, fontWeight: '700' },
  statLabel: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  provisional: { color: colors.textMuted, fontSize: 13, marginTop: spacing.sm },
  section: {
    color: colors.textMuted,
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  empty: { color: colors.textMuted, fontSize: 14 },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  badge: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  badgeWin: { backgroundColor: colors.success },
  badgeLoss: { backgroundColor: colors.danger },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  matchOpponent: { color: colors.text, fontSize: 15, marginLeft: spacing.md, flex: 1 },
  matchDelta: { fontSize: 15, fontWeight: '600' },
  deltaUp: { color: colors.success },
  deltaDown: { color: colors.danger },
});
