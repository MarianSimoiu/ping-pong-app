import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useTheme, type Colors } from '@/theme';

export function Avatar({
  uri,
  name,
  size,
}: {
  uri: string | null | undefined;
  name: string;
  size: number;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const style = { width: size, height: size, borderRadius: size / 2 };

  if (uri) {
    return <Image source={{ uri }} style={[styles.image, style]} />;
  }

  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={[styles.fallback, style]}>
      <Text style={[styles.initial, { fontSize: size * 0.4 }]}>{initial}</Text>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    image: { backgroundColor: colors.surfaceAlt },
    fallback: {
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    initial: { color: colors.textMuted, fontWeight: '700' },
  });
}
