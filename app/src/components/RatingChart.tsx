import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import type { HistoryPoint } from '@/lib/leaderboard';
import { colors, spacing } from '@/theme';

const HEIGHT = 160;
const PAD = 12;

// A minimal rating-over-time line chart. Single series, clear baseline, no
// chart junk — just enough to see the trajectory.
export function RatingChart({ points }: { points: HistoryPoint[] }) {
  const { width: screenWidth } = useWindowDimensions();
  const width = screenWidth - spacing.lg * 2; // account for screen padding

  if (points.length < 2) {
    return (
      <View style={[styles.empty, { height: HEIGHT }]}>
        <Text style={styles.emptyText}>Play a few matches to see your rating trend.</Text>
      </View>
    );
  }

  const ratings = points.map((p) => p.rating);
  const min = Math.min(...ratings);
  const max = Math.max(...ratings);
  const span = Math.max(max - min, 1); // avoid divide-by-zero on a flat line

  const innerW = width - PAD * 2;
  const innerH = HEIGHT - PAD * 2;

  const coords = points.map((p, i) => {
    const x = PAD + (i / (points.length - 1)) * innerW;
    const y = PAD + (1 - (p.rating - min) / span) * innerH;
    return { x, y };
  });
  const polyline = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const last = coords[coords.length - 1];

  return (
    <View>
      <Svg width={width} height={HEIGHT}>
        {/* baseline */}
        <Line x1={PAD} y1={HEIGHT - PAD} x2={width - PAD} y2={HEIGHT - PAD} stroke={colors.border} strokeWidth={1} />
        <Polyline
          points={polyline}
          fill="none"
          stroke={colors.primary}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <Circle cx={last.x} cy={last.y} r={4} fill={colors.primary} />
      </Svg>
      <View style={styles.axis}>
        <Text style={styles.axisText}>low {Math.round(min)}</Text>
        <Text style={styles.axisText}>high {Math.round(max)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 14 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  axisText: { color: colors.textMuted, fontSize: 12 },
});
