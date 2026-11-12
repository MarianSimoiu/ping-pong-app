import React, { useMemo, useRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Stop } from 'react-native-svg';

import { useBadge } from '@/context/BadgesContext';
import { RING_COLORS, ringFor, type RingStyle } from '@/lib/tiers';
import { useTheme, type Colors } from '@/theme';

// An id for this component's SVG gradients. Each avatar needs its own: with a
// shared id, browsers paint url(#id) from the first element with it, which
// can sit on a screen the navigator keeps hidden, and then nothing shows.
let gradientSeq = 0;
export function useGradientId(prefix: string): string {
  const id = useRef<string | null>(null);
  if (id.current === null) id.current = `${prefix}-${++gradientSeq}`;
  return id.current;
}

// Big enough for a corner badge (👑 season leader, 🏆 champion), and for the
// laurel champions get instead of the 🏆.
const BADGE_MIN_SIZE = 28;
const LAUREL_MIN_SIZE = 56;

// A player's photo (or initial). Given `playerId`, a ranked player's avatar
// gets a ring in their tier's colors (Legend for #1, grey when inactive), a
// gold laurel if they've won a tournament, and a crown if they lead the
// season points. All of it sits inside `size`, so layouts don't move.
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
  const badge = useBadge(playerId);
  const ring = ringFor(badge);
  const champion = (badge?.championCount ?? 0) > 0;
  const laurel = champion && size >= LAUREL_MIN_SIZE;
  const corner =
    size < BADGE_MIN_SIZE || !badge ? null : badge.seasonLeader ? '👑' : champion && !laurel ? '🏆' : null;

  const body = ring || laurel ? (
    <Ringed uri={uri} name={name} size={size} ring={ring} laurel={laurel} />
  ) : (
    <Photo uri={uri} name={name} size={size} />
  );
  if (!corner) return body;
  return (
    <View style={{ width: size, height: size }}>
      {body}
      <CornerBadge size={size} emoji={corner} />
    </View>
  );
}

// The ring (and laurel) on their own, for previews too.
export function Ringed({
  uri,
  name,
  size,
  ring,
  laurel = false,
}: {
  uri: string | null | undefined;
  name: string;
  size: number;
  ring: RingStyle | null;
  laurel?: boolean;
}) {
  const stroke = ring ? (size <= 24 ? 2 : size <= 40 ? 2.5 : size <= 64 ? 3 : 4) : 0;
  const gap = ring ? (size <= 24 ? 1 : 2) : 0;
  const leafSpace = laurel ? size * 0.14 : 0;
  const ringSize = size - 2 * leafSpace;
  const inner = ringSize - 2 * (stroke + gap);
  const gradientId = useGradientId('avatar-ring');
  const laurelId = useGradientId('avatar-laurel');
  return (
    <View style={{ width: size, height: size }} accessibilityLabel={`${name}${ring ? `, ${ring}` : ''}${laurel ? ', champion' : ''}`}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          {ring && (
            <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={RING_COLORS[ring][0]} />
              <Stop offset="1" stopColor={RING_COLORS[ring][1]} />
            </LinearGradient>
          )}
          {laurel && (
            <LinearGradient id={laurelId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFE58A" />
              <Stop offset="1" stopColor="#B8860B" />
            </LinearGradient>
          )}
        </Defs>
        {laurel && <Laurel size={size} fill={`url(#${laurelId})`} />}
        {ring && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={(ringSize - stroke) / 2}
            stroke={`url(#${gradientId})`}
            strokeWidth={stroke}
            fill="none"
          />
        )}
      </Svg>
      <View style={{ position: 'absolute', top: leafSpace + stroke + gap, left: leafSpace + stroke + gap }}>
        <Photo uri={uri} name={name} size={inner} />
      </View>
    </View>
  );
}

// Two branches of leaves up the sides of the avatar, open at the top.
function Laurel({ size, fill }: { size: number; fill: string }) {
  const c = size / 2;
  const leafLength = size * 0.15;
  const leafWidth = size * 0.065;
  const radius = c - leafLength * 0.5;
  const leaves: React.ReactElement[] = [];
  const count = 7;
  for (const side of [-1, 1]) {
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      // From near the bottom (90°) up each side; y grows downward.
      const angle = side < 0 ? 105 + t * 130 : 75 - t * 130;
      const rad = (angle * Math.PI) / 180;
      const x = c + radius * Math.cos(rad);
      const y = c + radius * Math.sin(rad);
      const scale = 1 - t * 0.3;
      const rotate = angle + 90 + side * 30;
      leaves.push(
        <Ellipse
          key={`${side}-${i}`}
          cx={x}
          cy={y}
          rx={(leafLength / 2) * scale}
          ry={(leafWidth / 2) * scale}
          fill={fill}
          transform={`rotate(${rotate} ${x} ${y})`}
        />,
      );
    }
  }
  return <>{leaves}</>;
}

function CornerBadge({ size, emoji }: { size: number; emoji: string }) {
  const { colors } = useTheme();
  const d = Math.max(14, Math.round(size * 0.38));
  return (
    <View
      style={{
        position: 'absolute',
        right: -2,
        bottom: -2,
        width: d,
        height: d,
        borderRadius: d / 2,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: d * 0.62, lineHeight: d * 0.9 }}>{emoji}</Text>
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
