import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, spacing, useTheme, type Colors } from '@/theme';

// A player's numbers in four boxes: rating, ±RD (with an ⓘ to How it works),
// win–loss record and season points. On player profiles and your own.
export function StatsRow({
  rating,
  rd,
  wins,
  losses,
  seasonPoints,
  onInfoPress,
}: {
  rating: number;
  rd: number;
  wins: number;
  losses: number;
  seasonPoints: number;
  onInfoPress?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.statsRow}>
      <Stat styles={styles} label="Rating" value={String(Math.round(rating))} />
      <Stat styles={styles} label="±RD" value={String(Math.round(rd))} onInfoPress={onInfoPress} />
      <Stat styles={styles} label="W–L" value={`${wins}–${losses}`} />
      <Stat styles={styles} label="Season" value={String(seasonPoints)} />
    </View>
  );
}

function Stat({
  styles,
  label,
  value,
  onInfoPress,
}: {
  styles: ReturnType<typeof createStyles>;
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

function createStyles(colors: Colors) {
  return StyleSheet.create({
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
  });
}
