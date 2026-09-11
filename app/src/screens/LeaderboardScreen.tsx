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

import { MIN_MATCHES_FOR_LEADERBOARD } from '@/lib/constants';
import {
  fetchLeaderboard,
  fetchSeasonStandings,
  type LeaderboardEntry,
  type SeasonEntry,
} from '@/lib/leaderboard';
import type { LeaderboardStackScreenProps } from '@/navigation/types';
import { colors, radius, spacing } from '@/theme';

type Tab = 'skill' | 'season';

const MEDALS = ['🥇', '🥈', '🥉'] as const;
// Top-3 get a medal in place of the plain rank number.
const rankLabel = (rank: number): string => MEDALS[rank - 1] ?? String(rank);

export function LeaderboardScreen({ navigation }: LeaderboardStackScreenProps<'Leaderboard'>) {
  const [tab, setTab] = useState<Tab>('skill');
  const [skill, setSkill] = useState<LeaderboardEntry[]>([]);
  const [season, setSeason] = useState<SeasonEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (which: Tab) => {
    setLoading(true);
    try {
      setError(null);
      if (which === 'skill') setSkill(await fetchLeaderboard());
      else setSeason(await fetchSeasonStandings());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(tab);
    }, [load, tab]),
  );

  const openProfile = (playerId: string, displayName: string) =>
    navigation.navigate('PlayerProfile', { playerId, displayName });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Text style={styles.title}>Leaderboard</Text>

      <View style={styles.tabs}>
        <TabButton label="Skill rating" active={tab === 'skill'} onPress={() => setTab('skill')} />
        <TabButton label="Season points" active={tab === 'season'} onPress={() => setTab('season')} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xl }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : tab === 'skill' ? (
        skill.length === 0 ? (
          <Empty
            emoji="🏓"
            text={`No ranked players yet. Players appear once they've played at least ${MIN_MATCHES_FOR_LEADERBOARD} matches.`}
          />
        ) : (
          <FlatList
            data={skill}
            keyExtractor={(e) => e.playerId}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <Pressable style={styles.row} onPress={() => openProfile(item.playerId, item.displayName)}>
                <Text style={styles.rank}>{rankLabel(item.rank)}</Text>
                <View style={styles.rowMain}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.displayName}
                  </Text>
                  <Text style={styles.rowMeta}>
                    ± {Math.round(item.rd)} · {item.matchesPlayed} matches
                  </Text>
                </View>
                <Text style={styles.rowValue}>{Math.round(item.rating)}</Text>
              </Pressable>
            )}
          />
        )
      ) : season.length === 0 ? (
        <Empty
          emoji="🎾"
          text="No season points yet. Points are earned by placing in tournaments and count over a rolling 52-week window."
        />
      ) : (
        <FlatList
          data={season}
          keyExtractor={(e) => e.playerId}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => openProfile(item.playerId, item.displayName)}>
              <Text style={styles.rank}>{rankLabel(item.rank)}</Text>
              <View style={styles.rowMain}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.displayName}
                </Text>
                <Text style={styles.rowMeta}>
                  {item.events} {item.events === 1 ? 'result' : 'results'} counted
                </Text>
              </View>
              <Text style={styles.rowValue}>{item.points}</Text>
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

function Empty({ emoji, text }: { emoji: string; text: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={styles.placeholder}>{text}</Text>
    </View>
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
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
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
  rowValue: { color: colors.primary, fontSize: 20, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emoji: { fontSize: 44, marginBottom: spacing.md },
  placeholder: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  error: { color: colors.danger, padding: spacing.lg },
});
