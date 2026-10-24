import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DoublesMatchCard, useDoublesConfirm } from '@/components/DoublesMatchCard';
import { TeamAvatars } from '@/components/TeamAvatars';
import { useAuth } from '@/context/AuthContext';
import { MIN_MATCHES_FOR_LEADERBOARD } from '@/lib/constants';
import {
  fetchDoublesAwaitingOpponents,
  fetchDoublesToConfirm,
  fetchMyTeams,
  fetchTeamLeaderboard,
  teamName,
  type DoublesPendingMatch,
  type RankedTeam,
  type Team,
} from '@/lib/doubles';
import { fetchMyProfile } from '@/lib/players';
import type { DoublesStackScreenProps } from '@/navigation/types';
import { radius, spacing, useTheme, type Colors } from '@/theme';

const MEDALS = ['🥇', '🥈', '🥉'] as const;
const rankLabel = (rank: number): string => MEDALS[rank - 1] ?? String(rank);

// The 2v2 hub: record a match, the pending ones, the team leaderboard and the
// viewer's own teams (ranked or not yet).
export function DoublesScreen({ navigation }: DoublesStackScreenProps<'DoublesHome'>) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { session } = useAuth();
  const [myId, setMyId] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<RankedTeam[]>([]);
  const [myTeams, setMyTeams] = useState<Team[]>([]);
  const [toConfirm, setToConfirm] = useState<DoublesPendingMatch[]>([]);
  const [awaiting, setAwaiting] = useState<DoublesPendingMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      setError(null);
      const me = await fetchMyProfile(session.user.id);
      const [lb, mine, confirmList, awaitingList] = await Promise.all([
        fetchTeamLeaderboard(),
        me ? fetchMyTeams(me.id) : [],
        me ? fetchDoublesToConfirm(me.id) : [],
        me ? fetchDoublesAwaitingOpponents(me.id) : [],
      ]);
      setMyId(me?.id ?? null);
      setLeaderboard(lb);
      setMyTeams(mine);
      setToConfirm(confirmList);
      setAwaiting(awaitingList);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load doubles');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const { actingId, act } = useDoublesConfirm(load);

  // "You & Emil" for the viewer's own teams.
  const myTeamName = (t: Team) => {
    const partner = t.members.find((m) => m.id !== myId) ?? t.members[1];
    return `You & ${partner.name}`;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.text} />}
      >
        <View style={styles.titleRow}>
          <Text style={styles.title}>2v2 Doubles</Text>
          <Pressable
            style={styles.howButton}
            onPress={() => navigation.navigate('HowRatingsWork')}
            hitSlop={8}
            accessibilityRole="link"
          >
            <Text style={styles.howButtonText}>ⓘ How it works</Text>
          </Pressable>
        </View>

        <Pressable style={styles.cta} onPress={() => navigation.navigate('RecordDoublesMatch')}>
          <Text style={styles.ctaText}>+ Record a doubles match</Text>
        </Pressable>

        {loading && leaderboard.length === 0 ? (
          <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xl }} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <>
            {toConfirm.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Awaiting your confirmation</Text>
                {toConfirm.map((m) => (
                  <DoublesMatchCard
                    key={m.matchId}
                    match={m}
                    busy={actingId === m.matchId}
                    onConfirm={() => act(m, 'confirm')}
                    onDecline={() => act(m, 'decline')}
                  />
                ))}
              </View>
            )}

            {awaiting.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Awaiting opponents’ confirmation</Text>
                {awaiting.map((m) => (
                  <DoublesMatchCard key={m.matchId} match={m} />
                ))}
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Team leaderboard</Text>
              {leaderboard.length === 0 ? (
                <Text style={styles.empty}>
                  No ranked teams yet. A team appears here after {MIN_MATCHES_FOR_LEADERBOARD} confirmed
                  matches together.
                </Text>
              ) : (
                leaderboard.map((t) => (
                  <View key={t.id} style={styles.row}>
                    <Text style={styles.rank}>{rankLabel(t.rank)}</Text>
                    <View style={styles.rowMain}>
                      <View style={styles.nameLine}>
                        <TeamAvatars team={t} />
                        <Text style={styles.rowName} numberOfLines={1}>
                          {teamName(t)}
                        </Text>
                      </View>
                      <Text style={styles.rowMeta}>
                        ± {Math.round(t.rd)} · {t.matchesPlayed} matches · {t.wins}-{t.losses}
                      </Text>
                    </View>
                    <Text style={styles.rowValue}>{Math.round(t.rating)}</Text>
                  </View>
                ))
              )}
            </View>

            {myTeams.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Your teams</Text>
                {myTeams.map((t) => {
                  const ranked = leaderboard.find((r) => r.id === t.id);
                  const toGo = MIN_MATCHES_FOR_LEADERBOARD - t.matchesPlayed;
                  return (
                    <View key={t.id} style={styles.row}>
                      <View style={styles.rowMain}>
                        <View style={styles.nameLine}>
                          <TeamAvatars team={t} />
                          <Text style={styles.rowName} numberOfLines={1}>
                            {myTeamName(t)}
                          </Text>
                        </View>
                        <Text style={styles.rowMeta}>
                          ± {Math.round(t.rd)} · {t.matchesPlayed} {t.matchesPlayed === 1 ? 'match' : 'matches'} ·{' '}
                          {t.wins}-{t.losses}
                        </Text>
                        <Text style={styles.rowStatus}>
                          {ranked
                            ? `Rank #${ranked.rank} on the team leaderboard`
                            : `Not ranked yet — ${toGo} more ${toGo === 1 ? 'match' : 'matches'} together`}
                        </Text>
                      </View>
                      <Text style={styles.rowValue}>{Math.round(t.rating)}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
    cta: {
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginTop: spacing.lg,
    },
    ctaText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
    section: { marginTop: spacing.lg },
    sectionLabel: {
      color: colors.textMuted,
      fontSize: 13,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: spacing.sm,
    },
    empty: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
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
    rowMain: { flex: 1, marginRight: spacing.sm },
    nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    rowName: { color: colors.text, fontSize: 16, fontWeight: '600', flexShrink: 1 },
    rowMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    rowStatus: { color: colors.primary, fontSize: 12, fontWeight: '600', marginTop: 2 },
    rowValue: { color: colors.primary, fontSize: 20, fontWeight: '800' },
    error: { color: colors.danger, marginTop: spacing.lg },
  });
}
