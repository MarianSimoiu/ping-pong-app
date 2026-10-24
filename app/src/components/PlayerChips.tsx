import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { OpponentOption } from '@/lib/types';
import { radius, spacing, useTheme, type Colors } from '@/theme';

// A wrap of tappable player-name chips; the ones in `selectedIds` are
// highlighted. Used to pick opponents and partners when recording a match.
export function PlayerChips({
  players,
  selectedIds,
  onPress,
}: {
  players: OpponentOption[];
  selectedIds: string[];
  onPress: (id: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.chips}>
      {players.map((p) => {
        const selected = selectedIds.includes(p.id);
        return (
          <Pressable
            key={p.id}
            style={[styles.chip, selected && styles.chipActive]}
            onPress={() => onPress(p.id)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.chipText, selected && styles.chipTextActive]}>{p.display_name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { color: colors.text, fontSize: 14 },
    chipTextActive: { color: colors.primaryText, fontWeight: '600' },
  });
}
