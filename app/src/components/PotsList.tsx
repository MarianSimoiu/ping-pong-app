import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import type { TournamentParticipant } from '@/lib/tournaments';
import { radius, spacing, useTheme, type Colors } from '@/theme';

// "Ana (you)" for the signed-in player (the demo's player is already "You").
export function withYou(name: string, isMe: boolean): string {
  return isMe && name !== 'You' ? `${name} (you)` : name;
}

// A tournament's players grouped by pot (best rating first in each), with the
// signed-in player marked. Live during registration, frozen after the draw.
export function PotsList({ participants, meId }: { participants: TournamentParticipant[]; meId: string | null }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pots = [...new Set(participants.map((p) => p.pot ?? 0))].sort((a, b) => a - b);

  return (
    <View style={{ gap: spacing.md }}>
      {pots.map((pot) => {
        const players = participants
          .filter((p) => (p.pot ?? 0) === pot)
          .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
        return (
          <View key={pot} style={styles.pot}>
            <View style={styles.potHeader}>
              <Text style={styles.potName}>{pot ? `Pot ${pot}` : 'Players'}</Text>
              <Text style={styles.potCount}>
                {players.length} {players.length === 1 ? 'player' : 'players'}
              </Text>
            </View>
            {players.map((p) => {
              const isMe = p.playerId === meId;
              return (
                <View key={p.playerId} style={[styles.player, isMe && styles.playerMe]}>
                  <Avatar uri={p.avatarUrl} name={p.name} size={28} />
                  <Text style={[styles.name, isMe && styles.nameMe]} numberOfLines={1}>
                    {withYou(p.name, isMe)}
                  </Text>
                  {p.rating !== null && <Text style={styles.rating}>{Math.round(p.rating)}</Text>}
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    pot: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    potHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      paddingVertical: spacing.xs,
    },
    potName: { color: colors.text, fontSize: 15, fontWeight: '700' },
    potCount: { color: colors.textMuted, fontSize: 12 },
    player: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: 6,
      paddingHorizontal: spacing.xs,
      borderRadius: radius.sm,
    },
    playerMe: { backgroundColor: colors.surfaceAlt },
    name: { color: colors.text, fontSize: 15, flex: 1 },
    nameMe: { fontWeight: '700' },
    rating: { color: colors.textMuted, fontSize: 13, fontVariant: ['tabular-nums'] },
  });
}
