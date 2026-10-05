import { type RouteProp, useRoute } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { RatingChart } from '@/components/RatingChart';
import { pickStreakLine, UPSET_DELTA_THRESHOLD } from '@/lib/commentary';
import {
  fetchMatchHistory,
  fetchPlayerById,
  fetchPlayerSeasonPoints,
  fetchRatingHistory,
  fetchRecord,
  type HistoryPoint,
  type MatchHistoryItem,
} from '@/lib/leaderboard';
import { showAlert } from '@/lib/platformAlert';
import type { PlayerWithRating } from '@/lib/types';
import { colors, radius, spacing } from '@/theme';

// A plain-language breakdown of why this player's RD is what it is — shown
// on demand (tap the info icon) rather than cluttering the stats row.
function describeRd(rd: number, matchesPlayed: number, provisional: boolean): string {
  const base =
    'Everyone starts at RD 350 — total uncertainty. Every confirmed match narrows it, since each game is new information about your real skill.';
  const status = provisional
    ? `Still provisional (under 10 matches), so this one is moving fast while the system learns where you belong — currently ±${Math.round(rd)} after ${matchesPlayed} match${matchesPlayed === 1 ? '' : 'es'}.`
    : `Settled in after ${matchesPlayed} matches, so it's down to ±${Math.round(rd)} — the system is fairly confident now.`;
  const tail = 'Stop playing for a while and it drifts back up, since the system gets less sure over time.';
  return `${base}\n\n${status}\n\n${tail}`;
}

// Count of leading same-result matches in a newest-first list — e.g. [W,W,W,L]
// is a 3-match win streak.
function currentStreak(matches: MatchHistoryItem[]): { count: number; kind: 'win' | 'loss' } | null {
  if (matches.length === 0) return null;
  const kind = matches[0].result;
  let count = 0;
  for (const m of matches) {
    if (m.result !== kind) break;
    count += 1;
  }
  return { count, kind };
}

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
  // Picked once per fresh match list, not on every re-render.
  const streakLine = useMemo(() => {
    const streak = currentStreak(matches);
    return streak ? pickStreakLine(streak.count, streak.kind) : null;
  }, [matches]);

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
              <Avatar uri={player?.avatar_url} name={player?.display_name ?? '?'} size={64} />
              <Text style={styles.name}>{player?.display_name}</Text>
            </View>

            <View style={styles.statsRow}>
              <Stat label="Rating" value={String(Math.round(rating?.rating ?? 1500))} />
              <Stat
                label="±RD"
                value={String(Math.round(rating?.rd ?? 350))}
                onInfoPress={() =>
                  showAlert(
                    'Why this RD?',
                    describeRd(rating?.rd ?? 350, rating?.matches_played ?? 0, isProvisional),
                  )
                }
              />
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
            {streakLine && (
              <View style={styles.streakBanner}>
                <Text style={styles.streakText}>{streakLine}</Text>
              </View>
            )}
            {matches.length === 0 ? (
              <Text style={styles.empty}>No matches yet.</Text>
            ) : (
              matches.map((m) => {
                const isUpset = Math.abs(m.delta) >= UPSET_DELTA_THRESHOLD;
                return (
                  <View key={m.id} style={styles.matchRow}>
                    <View style={[styles.badge, m.result === 'win' ? styles.badgeWin : styles.badgeLoss]}>
                      <Text style={styles.badgeText}>{m.result === 'win' ? 'W' : 'L'}</Text>
                    </View>
                    <View style={styles.matchMain}>
                      <Text style={styles.matchOpponent} numberOfLines={1}>
                        vs {m.opponentName}
                      </Text>
                      {m.games.length > 0 && (
                        <Text style={styles.matchScore} numberOfLines={1}>
                          {m.games.map((g) => `${g.myScore}–${g.opponentScore}`).join(', ')}
                        </Text>
                      )}
                    </View>
                    {isUpset && (
                      <Text style={styles.upsetTag}>{m.result === 'win' ? '🔥 SHOCKER' : '😱 SHOCKER'}</Text>
                    )}
                    <Text style={[styles.matchDelta, m.delta >= 0 ? styles.deltaUp : styles.deltaDown]}>
                      {m.delta >= 0 ? '+' : ''}
                      {Math.round(m.delta)}
                    </Text>
                  </View>
                );
              })
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({
  label,
  value,
  onInfoPress,
}: {
  label: string;
  value: string;
  onInfoPress?: () => void;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <View style={styles.statLabelRow}>
        <Text style={styles.statLabel}>{label}</Text>
        {onInfoPress && (
          <Pressable onPress={onInfoPress} hitSlop={8}>
            <Text style={styles.infoIcon}>ⓘ</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  name: { fontSize: 26, fontWeight: '700', color: colors.text },
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
  statLabelRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 3 },
  statLabel: { color: colors.textMuted, fontSize: 12 },
  infoIcon: { color: colors.textMuted, fontSize: 12 },
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
  streakBanner: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  streakText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  upsetTag: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
    marginRight: spacing.sm,
  },
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
  badgeText: { color: colors.primaryText, fontWeight: '700', fontSize: 13 },
  matchMain: { flex: 1, marginLeft: spacing.md },
  matchOpponent: { color: colors.text, fontSize: 15 },
  matchScore: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  matchDelta: { fontSize: 15, fontWeight: '600' },
  deltaUp: { color: colors.success },
  deltaDown: { color: colors.danger },
  error: { color: colors.danger, marginTop: spacing.lg },
});
