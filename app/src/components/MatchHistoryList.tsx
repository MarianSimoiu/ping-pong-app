import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { PlayerLink } from '@/components/PlayerLink';
import { boostLabel } from '@/lib/challenges';
import { pickStreakLine, UPSET_DELTA_THRESHOLD } from '@/lib/commentary';
import { formatTimestamp } from '@/lib/format';
import type { MatchHistoryItem } from '@/lib/leaderboard';
import { spacing, radius, useTheme, type Colors } from '@/theme';

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

// A player's recent matches, newest first: the streak banner, then one row per
// match (result, opponent, games, when, rating change, SHOCKER for an upset).
// On player profiles and your own.
export function MatchHistoryList({ matches }: { matches: MatchHistoryItem[] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Picked once per fresh match list, not on every re-render.
  const streakLine = useMemo(() => {
    const streak = currentStreak(matches);
    return streak ? pickStreakLine(streak.count, streak.kind) : null;
  }, [matches]);

  return (
    <>
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
          const gamesWon = m.games.filter((g) => g.myScore > g.opponentScore).length;
          return (
            <View key={m.id} style={styles.matchRow}>
              <View style={[styles.badge, m.result === 'win' ? styles.badgeWin : styles.badgeLoss]}>
                <Text style={styles.badgeText}>{m.result === 'win' ? 'W' : 'L'}</Text>
              </View>
              <View style={styles.matchMain}>
                <PlayerLink playerId={m.opponentId} name={m.opponentName} style={styles.opponentLine}>
                  <Text style={styles.matchOpponent}>vs</Text>
                  <Avatar uri={m.opponentAvatarUrl} name={m.opponentName} size={24} playerId={m.opponentId} />
                  <Text style={[styles.matchOpponent, styles.opponentName]} numberOfLines={1}>
                    {m.opponentName}
                  </Text>
                </PlayerLink>
                {m.games.length > 0 && (
                  <Text style={styles.matchScore} numberOfLines={1}>
                    <Text style={styles.matchOverall}>
                      {gamesWon}–{m.games.length - gamesWon}
                    </Text>
                    {' · '}
                    {m.games.map((g) => `${g.myScore}–${g.opponentScore}`).join(', ')}
                  </Text>
                )}
                <Text style={styles.matchTime}>{formatTimestamp(m.at)}</Text>
              </View>
              {isUpset && <Text style={styles.upsetTag}>{m.result === 'win' ? '🔥 SHOCKER' : '😱 SHOCKER'}</Text>}
              {/* A challenge match (0031), with a win's boost. */}
              {m.challenge && (
                <Text style={styles.challengeTag} accessibilityLabel={m.boost ? `Challenge win, ${boostLabel(m.boost)}` : 'Challenge match'}>
                  ⚡{m.boost ? ` ${boostLabel(m.boost)}` : ''}
                </Text>
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
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
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
    challengeTag: {
      color: colors.primary,
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
    opponentLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    matchOpponent: { color: colors.text, fontSize: 15 },
    opponentName: { flexShrink: 1 },
    matchScore: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
    matchOverall: { color: colors.text, fontWeight: '700' },
    matchTime: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
    matchDelta: { fontSize: 15, fontWeight: '600' },
    deltaUp: { color: colors.success },
    deltaDown: { color: colors.danger },
  });
}
