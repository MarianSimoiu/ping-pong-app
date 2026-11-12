import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { useGradientId } from '@/components/Avatar';
import { RING_COLORS, ringFor, tierName, type PlayerBadge } from '@/lib/tiers';
import { useTheme, type Colors } from '@/theme';

const DOT = 8;

// A small chip with a player's tier: a dot in their avatar ring's colors and
// the tier's name ("Gold", "Legend"). Nothing for players without a tier.
export function TierPill({ badge }: { badge: PlayerBadge | null | undefined }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const dotId = useGradientId('tier-dot');
  const ring = ringFor(badge);
  if (!badge || !ring) return null;

  const name = tierName(badge);
  const [from, to] = RING_COLORS[ring];
  return (
    <View style={styles.pill} accessibilityLabel={`${name} tier${badge.inactive ? ', inactive' : ''}`}>
      <Svg width={DOT} height={DOT}>
        <Defs>
          <LinearGradient id={dotId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Circle cx={DOT / 2} cy={DOT / 2} r={DOT / 2} fill={`url(#${dotId})`} />
      </Svg>
      <Text style={styles.name}>{name}</Text>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 999,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
    },
    name: { color: colors.text, fontSize: 11, fontWeight: '600' },
  });
}
