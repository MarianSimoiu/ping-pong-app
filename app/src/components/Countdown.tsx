import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { timeLeft } from '@/lib/countdown';
import { radius, spacing, useTheme, type Colors } from '@/theme';

// Days · hours · minutes · seconds until `to`, as four tiles. `now` comes
// from the screen's useNow(), so the screen decides when it ticks.
export function Countdown({ to, now }: { to: string; now: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const t = timeLeft(to, now);
  const parts: [number, string][] = [
    [t.days, t.days === 1 ? 'day' : 'days'],
    [t.hours, 'hrs'],
    [t.minutes, 'min'],
    [t.seconds, 'sec'],
  ];
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${t.days} days, ${t.hours} hours, ${t.minutes} minutes to kickoff`}
    >
      {parts.map(([value, unit]) => (
        <View key={unit} style={styles.tile}>
          <Text style={styles.value}>{String(value).padStart(2, '0')}</Text>
          <Text style={styles.unit}>{unit}</Text>
        </View>
      ))}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    row: { flexDirection: 'row', gap: spacing.sm },
    tile: {
      flex: 1,
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.sm,
    },
    value: {
      color: colors.text,
      fontSize: 28,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    unit: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 2,
    },
  });
}
