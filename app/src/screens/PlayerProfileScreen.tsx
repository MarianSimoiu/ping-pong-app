import { type RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { MatchHistoryList } from '@/components/MatchHistoryList';
import { RatingChart } from '@/components/RatingChart';
import { StatsRow } from '@/components/StatsRow';
import { TierCard } from '@/components/TierCard';
import { TrophyCabinet } from '@/components/TrophyCabinet';
import { useBadge, useBadges } from '@/context/BadgesContext';
import { MIN_MATCHES_FOR_LEADERBOARD } from '@/lib/constants';
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
import { spacing, useTheme, type Colors } from '@/theme';

// Shared param shape (the route exists in every tab's stack, and each of them
// has the How ratings work page too).
type ParamList = {
  PlayerProfile: { playerId: string; displayName: string };
  HowRatingsWork: undefined;
};

export function PlayerProfileScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const route = useRoute<RouteProp<ParamList, 'PlayerProfile'>>();
  const navigation = useNavigation<NativeStackNavigationProp<ParamList>>();
  const { playerId } = route.params;
  const { meId } = useBadges();
  const badge = useBadge(playerId);

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
      if (p) navigation.setOptions({ title: p.display_name });
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
  const isRanked = (rating?.matches_played ?? 0) >= MIN_MATCHES_FOR_LEADERBOARD;

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
            <View style={styles.header}>
              <Avatar uri={player?.avatar_url} name={player?.display_name ?? '?'} size={72} playerId={player?.id} />
              <Text style={styles.name}>{player?.display_name}</Text>
              {badge?.titleLabel && <Text style={styles.titleLabel}>{badge.titleLabel}</Text>}
            </View>

            <StatsRow
              rating={rating?.rating ?? 1500}
              rd={rating?.rd ?? 350}
              wins={record.wins}
              losses={record.losses}
              seasonPoints={seasonPoints}
              onInfoPress={() => navigation.navigate('HowRatingsWork')}
            />
            {!isRanked && (
              <Text style={styles.unranked}>
                Not ranked yet — players join the leaderboard after {MIN_MATCHES_FOR_LEADERBOARD}{' '}
                matches.
              </Text>
            )}
            {isRanked && (
              <TierCard
                playerId={player?.id}
                rating={rating?.rating ?? 1500}
                matchesPlayed={rating?.matches_played ?? 0}
                isMe={!!meId && player?.id === meId}
              />
            )}

            <Text style={styles.section}>Rating over time</Text>
            <RatingChart points={history} />

            <Text style={styles.section}>Recent matches</Text>
            <MatchHistoryList matches={matches} />

            {player && <TrophyCabinet playerId={player.id} isMe={!!meId && player.id === meId} />}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
    name: { fontSize: 26, fontWeight: '700', color: colors.text },
    titleLabel: { color: colors.textMuted, fontSize: 14, fontStyle: 'italic', marginTop: 2 },
    unranked: { color: colors.textMuted, fontSize: 13, marginTop: spacing.sm },
    section: {
      color: colors.textMuted,
      fontSize: 13,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: spacing.xl,
      marginBottom: spacing.sm,
    },
    error: { color: colors.danger, marginTop: spacing.lg },
  });
}
