import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { pickDeclineLine } from '@/lib/commentary';
import { confirmDoublesMatch, type DoublesPendingMatch } from '@/lib/doubles';
import { formatTimestamp } from '@/lib/format';
import { showAlert } from '@/lib/platformAlert';
import { radius, spacing, useTheme, type Colors } from '@/theme';

// Confirm / decline handling for DoublesMatchCard, shared by Home and the
// Doubles tab. `onDone` reloads the screen's lists afterwards.
export function useDoublesConfirm(onDone: () => void) {
  const [actingId, setActingId] = useState<string | null>(null);
  const act = useCallback(
    async (match: DoublesPendingMatch, action: 'confirm' | 'decline') => {
      setActingId(match.matchId);
      try {
        const result = await confirmDoublesMatch(match.matchId, action);
        if (action === 'confirm') {
          const team = result.yourTeam;
          showAlert(
            'Match confirmed',
            `You & ${match.partnerName} ${match.iWon ? 'won' : 'lost'} ${match.myGames}–${match.opponentGames}.` +
              (team ? ` Team rating ${team.delta >= 0 ? '+' : ''}${team.delta}, now ${team.rating}.` : ''),
          );
        } else {
          showAlert('Waved off', pickDeclineLine());
        }
        onDone();
      } catch (e) {
        showAlert('Couldn’t update the match', e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setActingId(null);
      }
    },
    [onDone],
  );
  return { actingId, act };
}

// A pending 2v2 match, from the viewer's side. With onConfirm/onDecline it's
// one the viewer has to act on (they're an opponent: either of the two can
// confirm); without, it's their team's match, waiting on the opponents.
export function DoublesMatchCard({
  match,
  busy,
  onConfirm,
  onDecline,
}: {
  match: DoublesPendingMatch;
  busy?: boolean;
  onConfirm?: () => void;
  onDecline?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [o1, o2] = match.opponentNames;
  const opponents = `${o1} & ${o2}`;
  const actionable = Boolean(onConfirm && onDecline);
  const result = `${match.iWon ? 'won' : 'lost'} ${match.myGames}–${match.opponentGames}`;

  return (
    <View style={[styles.card, actionable && styles.cardActionable]}>
      <Text style={styles.teams}>
        You & {match.partnerName} <Text style={styles.vs}>vs</Text> {opponents}
      </Text>
      <Text style={styles.time}>{formatTimestamp(match.submittedAt)}</Text>

      {actionable ? (
        <Text style={styles.text}>
          {match.submitterName} recorded it: your team {result}.
        </Text>
      ) : (
        <Text style={[styles.text, styles.result, match.iWon ? styles.win : styles.loss]}>
          Your team {result}
        </Text>
      )}
      <Text style={styles.sets}>
        Sets (your team–{opponents}):{' '}
        {match.games.map((g) => `${g.myScore}–${g.opponentScore}`).join(', ')}
      </Text>

      {actionable ? (
        <View style={styles.actions}>
          <Pressable style={[styles.confirmBtn, busy && styles.busy]} onPress={onConfirm} disabled={busy}>
            <Text style={styles.confirmText}>Confirm</Text>
          </Pressable>
          <Pressable style={[styles.declineBtn, busy && styles.busy]} onPress={onDecline} disabled={busy}>
            <Text style={styles.declineText}>Decline</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.waiting}>
          Waiting for {o1} or {o2} to confirm
        </Text>
      )}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardActionable: { borderColor: colors.primary },
    teams: { color: colors.text, fontSize: 14, fontWeight: '700' },
    vs: { color: colors.textMuted, fontWeight: '400' },
    time: { color: colors.textMuted, fontSize: 11, marginBottom: spacing.sm },
    text: { color: colors.text, fontSize: 14, marginBottom: spacing.xs },
    result: { fontWeight: '700' },
    win: { color: colors.success },
    loss: { color: colors.danger },
    sets: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.sm },
    actions: { flexDirection: 'row', gap: spacing.sm },
    confirmBtn: {
      backgroundColor: colors.primary,
      borderRadius: radius.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    confirmText: { color: colors.primaryText, fontWeight: '600' },
    declineBtn: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    declineText: { color: colors.danger, fontWeight: '600' },
    busy: { opacity: 0.5 },
    waiting: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic' },
  });
}
