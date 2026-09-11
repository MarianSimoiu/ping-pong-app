import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { pickChampionLine } from '@/lib/commentary';
import { fetchTournamentDetail, type TournamentDetail, type TournamentNode } from '@/lib/tournaments';
import type { TournamentsStackScreenProps } from '@/navigation/types';
import { colors, radius, spacing } from '@/theme';

function roundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  return `Round ${round}`;
}

export function TournamentDetailScreen({
  route,
  navigation,
}: TournamentsStackScreenProps<'TournamentDetail'>) {
  const { tournamentId } = route.params;
  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setDetail(await fetchTournamentDetail(tournamentId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tournament');
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Computed before the early returns below so the hook order stays stable;
  // `detail` may still be null on the first render.
  const champion =
    detail?.tournament.status === 'completed'
      ? detail.nodes.find((n) => n.round === detail.totalRounds)?.winnerId ?? null
      : null;
  const championName = champion ? detail?.nameById[champion] : null;
  // Picked once per champion so it doesn't change on every re-render/refresh.
  const championLine = useMemo(
    () => (championName ? pickChampionLine(championName) : null),
    [championName],
  );

  if (loading && !detail) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xl }} />
      </SafeAreaView>
    );
  }
  if (error || !detail) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.error}>{error ?? 'Not found'}</Text>
      </SafeAreaView>
    );
  }

  const { nodes, nameById, totalRounds, tournament } = detail;
  const rounds = Array.from(new Set(nodes.map((n) => n.round))).sort((a, b) => a - b);
  const nameOf = (id: string | null, fallback: string) => (id ? nameById[id] ?? 'Unknown' : fallback);

  function onNodePress(node: TournamentNode) {
    if (node.status !== 'ready' || !node.playerA || !node.playerB) return;
    navigation.navigate('RecordTournamentMatch', {
      tournamentMatchId: node.id,
      tournamentId,
      playerAName: nameOf(node.playerA, 'A'),
      playerBName: nameOf(node.playerB, 'B'),
      bestOf: tournament.bestOf,
    });
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {championLine && (
          <View style={styles.champion}>
            <Text style={styles.championEmoji}>🏆</Text>
            <Text style={styles.championText}>{championLine}</Text>
          </View>
        )}

        {rounds.map((round) => (
          <View key={round}>
            <Text style={styles.roundLabel}>{roundLabel(round, totalRounds)}</Text>
            {nodes
              .filter((n) => n.round === round)
              .map((node) => {
                const isReady = node.status === 'ready';
                const aName = nameOf(node.playerA, node.status === 'pending' ? 'TBD' : 'Bye');
                const bName = nameOf(node.playerB, node.status === 'pending' ? 'TBD' : 'Bye');
                return (
                  <Pressable
                    key={node.id}
                    style={[styles.match, isReady && styles.matchReady]}
                    onPress={() => onNodePress(node)}
                    disabled={!isReady}
                  >
                    <View style={{ flex: 1 }}>
                      <PlayerLine name={aName} isWinner={node.winnerId === node.playerA && !!node.winnerId} />
                      <View style={styles.divider} />
                      <PlayerLine name={bName} isWinner={node.winnerId === node.playerB && !!node.winnerId} />
                    </View>
                    {isReady && <Text style={styles.record}>Record ›</Text>}
                    {node.status === 'completed' && <Text style={styles.done}>✓</Text>}
                  </Pressable>
                );
              })}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function PlayerLine({ name, isWinner }: { name: string; isWinner: boolean }) {
  return (
    <Text style={[styles.player, isWinner && styles.winner]} numberOfLines={1}>
      {name}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  champion: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  championEmoji: { fontSize: 36 },
  championText: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: spacing.xs },
  roundLabel: {
    color: colors.textMuted,
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  match: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  matchReady: { borderColor: colors.primary },
  player: { color: colors.text, fontSize: 15 },
  winner: { color: colors.success, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  record: { color: colors.primary, fontWeight: '600', marginLeft: spacing.md },
  done: { color: colors.success, fontSize: 18, marginLeft: spacing.md },
  error: { color: colors.danger, padding: spacing.lg },
});
