import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { PlayerLink } from '@/components/PlayerLink';
import { useBadges } from '@/context/BadgesContext';
import { pickDeclineLine, pickMatchResultLine, pickPendingLine } from '@/lib/commentary';
import { formatTimestamp } from '@/lib/format';
import { confirmMatch } from '@/lib/matches';
import { showAlert } from '@/lib/platformAlert';
import type { PendingMatch } from '@/lib/types';
import { radius, spacing, useTheme, type Colors } from '@/theme';

// Confirm / decline handling for PendingMatchCard, shared by Home and Profile
// (the doubles one is useDoublesConfirm). `onDone` reloads the screen's lists
// afterwards; the card stays disabled until it has.
export function useMatchConfirm(onDone: () => void | Promise<void>) {
  const { refresh: refreshBadges } = useBadges();
  const [actingId, setActingId] = useState<string | null>(null);
  const act = useCallback(
    async (match: PendingMatch, action: 'confirm' | 'decline') => {
      setActingId(match.matchId);
      try {
        const result = await confirmMatch(match.matchId, action);
        // A confirmed result can move tiers: refresh the rings (and the tier popup).
        if (action === 'confirm') refreshBadges();
        if (action === 'confirm' && result.you) {
          showAlert(
            'MATCH CALLED!',
            pickMatchResultLine({
              iWon: match.iWon,
              myGames: match.myGames,
              opponentGames: match.opponentGames,
              opponentName: match.submitterName,
              delta: result.you.delta,
            }),
          );
        } else if (action === 'decline') {
          showAlert('Waved off', pickDeclineLine());
        }
        await onDone();
      } catch (e) {
        showAlert('Couldn’t update the match', e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setActingId(null);
      }
    },
    [onDone, refreshBadges],
  );
  return { actingId, act };
}

// A singles match the opponent recorded against the viewer, waiting for them
// to confirm or decline it.
export function PendingMatchCard({
  match: m,
  busy,
  onConfirm,
  onDecline,
}: {
  match: PendingMatch;
  busy: boolean;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.card}>
      {m.tournament && <Text style={styles.kicker}>🏆 {m.tournament.name} · tournament result</Text>}
      <PlayerLink playerId={m.submitterId} name={m.submitterName} style={styles.headerRow}>
        <Avatar uri={m.submitterAvatarUrl} name={m.submitterName} size={36} playerId={m.submitterId} />
        <View style={styles.headerText}>
          <Text style={styles.name}>{m.submitterName}</Text>
          <Text style={styles.time}>{formatTimestamp(m.submittedAt)}</Text>
        </View>
      </PlayerLink>
      <Text style={styles.text}>
        {pickPendingLine({
          submitterName: m.submitterName,
          iWon: m.iWon,
          myGames: m.myGames,
          opponentGames: m.opponentGames,
        })}
      </Text>
      <Text style={styles.sets}>
        Sets (you–{m.submitterName}): {m.games.map((g) => `${g.myScore}–${g.opponentScore}`).join(', ')}
      </Text>
      <View style={styles.actions}>
        <Pressable style={[styles.confirmBtn, busy && { opacity: 0.5 }]} onPress={onConfirm} disabled={busy}>
          <Text style={styles.confirmText}>Confirm</Text>
        </Pressable>
        <Pressable style={[styles.declineBtn, busy && { opacity: 0.5 }]} onPress={onDecline} disabled={busy}>
          <Text style={styles.declineText}>Decline</Text>
        </Pressable>
      </View>
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
      borderColor: colors.primary,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginBottom: spacing.sm },
    headerText: { marginLeft: spacing.sm },
    name: { color: colors.text, fontSize: 14, fontWeight: '700' },
    kicker: { color: colors.textMuted, fontSize: 12, fontWeight: '700', marginBottom: spacing.xs },
    time: { color: colors.textMuted, fontSize: 11 },
    text: { color: colors.text, fontSize: 14, marginBottom: spacing.xs },
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
  });
}
