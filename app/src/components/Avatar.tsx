import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { useBadge } from '@/context/BadgesContext';
import { RING_COLORS, ringFor, type RingStyle } from '@/lib/tiers';
import { useTheme, type Colors } from '@/theme';

// A player's photo (or initial). Given `playerId`, a ranked player's avatar
// gets a ring in their tier's colors (Legend for #1, grey when inactive);
// the ring sits inside `size`, so layouts don't move.
export function Avatar({
  uri,
  name,
  size,
  playerId,
}: {
  uri: string | null | undefined;
  name: string;
  size: number;
  playerId?: string | null;
}) {
  const ring = ringFor(useBadge(playerId));
  if (!ring) return <Photo uri={uri} name={name} size={size} />;
  return <Ringed uri={uri} name={name} size={size} ring={ring} />;
}

// The ring on its own, for previews (e.g. the promotion popup).
export function Ringed({
  uri,
  name,
  size,
  ring,
}: {
  uri: string | null | undefined;
  name: string;
  size: number;
  ring: RingStyle;
}) {
  const stroke = size <= 24 ? 2 : size <= 40 ? 2.5 : size <= 64 ? 3 : 4;
  const gap = size <= 24 ? 1 : 2;
  const inner = size - 2 * (stroke + gap);
  const [from, to] = RING_COLORS[ring];
  // One gradient per ring style: identical definitions can share an id.
  const gradientId = `avatar-ring-${ring}`;
  return (
    <View style={{ width: size, height: size }} accessibilityLabel={`${name}, ${ring}`}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={(size - stroke) / 2}
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          fill="none"
        />
      </Svg>
      <View style={{ position: 'absolute', top: stroke + gap, left: stroke + gap }}>
        <Photo uri={uri} name={name} size={inner} />
      </View>
    </View>
  );
}

function Photo({ uri, name, size }: { uri: string | null | undefined; name: string; size: number }) {
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
