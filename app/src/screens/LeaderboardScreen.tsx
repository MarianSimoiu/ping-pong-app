import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchLeaderboard, type LeaderboardEntry } from '@/lib/leaderboard';
import { MIN_MATCHES_FOR_LEADERBOARD } from '@/lib/constants';
import type { LeaderboardStackScreenProps } from '@/navigation/types';
import { colors, radius, spacing } from '@/theme';

type Tab = 'skill' | 'season';

export function LeaderboardScreen({ navigation }: LeaderboardStackScreenProps<'Leaderboard'>) {
  const [tab, setTab] = useState<Tab>('skill');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setEntries(await fetchLeaderboard());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (tab === 'skill') load();
    }, [load, tab]),
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Text style={styles.title}>Leaderboard</Text>

      <View style={styles.tabs}>
        <TabButton label="Skill rating" active={tab === 'skill'} onPress={() => setTab('skill')} />
        <TabButton label="Season points" active={tab === 'season'} onPress={() => setTab('season')} />
      </View>

      {tab === 'season' ? (
        <View style={styles.center}>
          <Text style={styles.emoji}>🎾</Text>
          <Text style={styles.placeholder}>
            Season points (WTA-style, from tournament results) arrive in Phase 5.
          </Text>
        </View>
      ) : loading ? (
        <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xl }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : entries.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emoji}>🏓</Text>
          <Text style={styles.placeholder}>
            No ranked players yet. Players appear here once they've played at least{' '}
            {MIN_MATCHES_FOR_LEADERBOARD} matches.
          </Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.playerId}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() =>
                navigation.navigate('PlayerProfile', {
                  playerId: item.playerId,
                  displayName: item.displayName,
                })
              }
            >
              <Text style={styles.rank}>{item.rank}</Text>
              <View style={styles.rowMain}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.displayName}
                </Text>
                <Text style={styles.rowMeta}>
                  ± {Math.round(item.rd)} · {item.matchesPlayed} matches
                </Text>
              </View>
              <Text style={styles.rowRating}>{Math.round(item.rating)}</Text>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  tabs: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, paddingBottom: spacing.md },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: colors.primaryText },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rank: { color: colors.textMuted, fontSize: 16, fontWeight: '700', width: 28 },
  rowMain: { flex: 1, marginLeft: spacing.sm },
  rowName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  rowMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  rowRating: { color: colors.primary, fontSize: 20, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emoji: { fontSize: 44, marginBottom: spacing.md },
  placeholder: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  error: { color: colors.danger, padding: spacing.lg },
});
