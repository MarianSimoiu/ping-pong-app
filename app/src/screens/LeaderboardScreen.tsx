import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { TeamAvatars } from '@/components/TeamAvatars';
import { MIN_MATCHES_FOR_LEADERBOARD } from '@/lib/constants';
import { fetchTeamLeaderboard, teamName, type RankedTeam } from '@/lib/doubles';
import {
  fetchLeaderboard,
  fetchSeasonStandings,
  type LeaderboardEntry,
  type SeasonEntry,
} from '@/lib/leaderboard';
import type { LeaderboardStackScreenProps } from '@/navigation/types';
import { radius, spacing, useTheme, type Colors } from '@/theme';

type Tab = 'skill' | 'season' | 'doubles';

const MEDALS = ['🥇', '🥈', '🥉'] as const;
// Top-3 get a medal in place of the plain rank number.
const rankLabel = (rank: number): string => MEDALS[rank - 1] ?? String(rank);

export function LeaderboardScreen({ navigation }: LeaderboardStackScreenProps<'Leaderboard'>) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [tab, setTab] = useState<Tab>('skill');
  const [skill, setSkill] = useState<LeaderboardEntry[]>([]);
  const [season, setSeason] = useState<SeasonEntry[]>([]);
  const [doubles, setDoubles] = useState<RankedTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (which: Tab) => {
    setLoading(true);
    try {
      setError(null);
      if (which === 'skill') setSkill(await fetchLeaderboard());
      else if (which === 'season') setSeason(await fetchSeasonStandings());
      else setDoubles(await fetchTeamLeaderboard());
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
      <View style={styles.titleRow}>
        <Text style={styles.title}>Leaderboard</Text>
        <Pressable
          style={styles.howButton}
          onPress={() => navigation.navigate('HowRatingsWork')}
          hitSlop={8}
          accessibilityRole="link"
        >
          <Text style={styles.howButtonText}>ⓘ How it works</Text>
        </Pressable>
      </View>

      <View style={styles.tabs}>
        <TabButton label="Skill rating" active={tab === 'skill'} onPress={() => setTab('skill')} />
        <TabButton label="Season points" active={tab === 'season'} onPress={() => setTab('season')} />
        <TabButton label="Doubles" active={tab === 'doubles'} onPress={() => setTab('doubles')} />
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
                  <View style={styles.nameLine}>
                    <Avatar uri={item.avatarUrl} name={item.displayName} size={20} />
                    <Text style={styles.rowName} numberOfLines={1}>
                      {item.displayName}
                    </Text>
                  </View>
                  <Text style={styles.rowMeta}>
                    ± {Math.round(item.rd)} · {item.matchesPlayed} matches · {item.wins}-{item.losses}
                  </Text>
                </View>
                <Text style={styles.rowValue}>{Math.round(item.rating)}</Text>
              </Pressable>
            )}
          />
        )
      ) : tab === 'season' ? (
        season.length === 0 ? (
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
                  <View style={styles.nameLine}>
                    <Avatar uri={item.avatarUrl} name={item.displayName} size={20} />
                    <Text style={styles.rowName} numberOfLines={1}>
                      {item.displayName}
                    </Text>
                  </View>
                  <Text style={styles.rowMeta}>
                    {item.events} {item.events === 1 ? 'result' : 'results'} counted
                  </Text>
                </View>
                <Text style={styles.rowValue}>{item.points}</Text>
              </Pressable>
            )}
          />
        )
      ) : doubles.length === 0 ? (
        <Empty
          emoji="🤝"
          text={`No ranked teams yet. A team appears once it has played at least ${MIN_MATCHES_FOR_LEADERBOARD} matches together.`}
        />
      ) : (
        <FlatList
          data={doubles}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.rank}>{rankLabel(item.rank)}</Text>
              <View style={styles.rowMain}>
                <View style={styles.nameLine}>
                  <TeamAvatars team={item} />
                  <Text style={styles.rowName} numberOfLines={1}>
                    {teamName(item)}
                  </Text>
                </View>
                <Text style={styles.rowMeta}>
                  ± {Math.round(item.rd)} · {item.matchesPlayed} matches · {item.wins}-{item.losses}
                </Text>
              </View>
              <Text style={styles.rowValue}>{Math.round(item.rating)}</Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Empty({ emoji, text }: { emoji: string; text: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.center}>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={styles.placeholder}>{text}</Text>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
    },
    title: { fontSize: 24, fontWeight: '700', color: colors.text },
    howButton: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderWidth: 1,
      borderColor: colors.border,
    },
    howButtonText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    tabs: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, paddingBottom: spacing.md },
    tab: {
      flex: 1,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      alignItems: 'center',
      // Centered both ways, so a label that wraps on a narrow phone still looks even.
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    tabText: { color: colors.textMuted, fontSize: 14, fontWeight: '600', textAlign: 'center' },
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
    nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    rowName: { color: colors.text, fontSize: 16, fontWeight: '600', flexShrink: 1 },
    rowMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    rowValue: { color: colors.primary, fontSize: 20, fontWeight: '800' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    emoji: { fontSize: 44, marginBottom: spacing.md },
    placeholder: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
    error: { color: colors.danger, padding: spacing.lg },
  });
}
