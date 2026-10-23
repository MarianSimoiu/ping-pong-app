import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { formatTimestamp } from '@/lib/format';
import type { SubmittedPendingMatch } from '@/lib/types';
import { radius, spacing, useTheme, type Colors } from '@/theme';

// Matches the signed-in player recorded that are still waiting for the
// opponent to confirm (shown on Home and Profile). Renders nothing when there
// are none.
export function AwaitingOpponentList({
  matches,
  style,
}: {
  matches: SubmittedPendingMatch[];
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (matches.length === 0) return null;

  return (
    <View style={style}>
      <Text style={styles.sectionLabel}>Awaiting opponent’s confirmation</Text>
      {matches.map((m) => (
        <View key={m.matchId} style={styles.card}>
          <View style={styles.headerRow}>
            <Avatar uri={m.opponentAvatarUrl} name={m.opponentName} size={36} />
            <View style={styles.headerText}>
              <Text style={styles.name}>vs {m.opponentName}</Text>
              <Text style={styles.time}>{formatTimestamp(m.submittedAt)}</Text>
            </View>
            <Text style={[styles.result, m.iWon ? styles.resultWin : styles.resultLoss]}>
              {m.iWon ? 'Won' : 'Lost'} {m.myGames}–{m.opponentGames}
            </Text>
          </View>
          <Text style={styles.sets}>
            Sets (you–{m.opponentName}):{' '}
            {m.games.map((g) => `${g.myScore}–${g.opponentScore}`).join(', ')}
          </Text>
          <Text style={styles.waitingNote}>Waiting for {m.opponentName} to confirm</Text>
        </View>
      ))}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    sectionLabel: {
      color: colors.textMuted,
      fontSize: 13,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: spacing.sm,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
    headerText: { flex: 1, marginLeft: spacing.sm },
    name: { color: colors.text, fontSize: 14, fontWeight: '700' },
    time: { color: colors.textMuted, fontSize: 11 },
    result: { fontSize: 13, fontWeight: '700' },
    resultWin: { color: colors.success },
    resultLoss: { color: colors.danger },
    sets: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.xs },
    waitingNote: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic' },
  });
}
