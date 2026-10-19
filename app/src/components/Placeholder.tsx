import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { spacing, useTheme, type Colors } from '@/theme';

// Simple centered placeholder used by screens that arrive in later phases.
export function Placeholder({ emoji, title, note }: { emoji: string; title: string; note: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.note}>{note}</Text>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
    },
    emoji: { fontSize: 48, marginBottom: spacing.md },
    title: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
    note: { fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
  });
}
