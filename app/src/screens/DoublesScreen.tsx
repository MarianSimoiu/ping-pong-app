import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { radius, spacing, useTheme, type Colors } from '@/theme';

export function DoublesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>2v2 Doubles</Text>
      </View>

      <View style={styles.center}>
        <Text style={styles.emoji}>🤝</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>COMING SOON</Text>
        </View>
        <Text style={styles.placeholder}>
          Team up and track doubles matches and ratings. For now, keep grinding
          singles.
        </Text>
      </View>
    </SafeAreaView>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
    },
    title: { fontSize: 24, fontWeight: '700', color: colors.text },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    emoji: { fontSize: 44, marginBottom: spacing.md },
    badge: {
      backgroundColor: colors.accent,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      marginBottom: spacing.md,
    },
    // accentText, not primaryText: primaryText is white (for the vivid
    // primary/success/danger backgrounds) and fails contrast on the lighter
    // gold accent — accentText is the token meant for this pairing.
    badgeText: { color: colors.accentText, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
    placeholder: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  });
}
