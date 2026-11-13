import React from 'react';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';

// A 1-2-3 podium for the Leaderboard tab (no emoji has one): gold in the
// middle, silver on the left, bronze on the right, numbered.
const STEPS = [
  { place: 2, x: 1, top: 9, fill: '#98A4B0' },
  { place: 1, x: 8.5, top: 3, fill: '#E3A20B' },
  { place: 3, x: 16, top: 13, fill: '#C0713A' },
] as const;

export function PodiumIcon({ size = 22 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      {STEPS.map((s) => (
        <React.Fragment key={s.place}>
          <Rect x={s.x} y={s.top} width={7} height={23 - s.top} rx={1.4} fill={s.fill} />
          <SvgText
            x={s.x + 3.5}
            y={s.top + 6.6}
            fontSize={7}
            fontWeight="900"
            fill="#FFFFFF"
            textAnchor="middle"
          >
            {s.place}
          </SvgText>
        </React.Fragment>
      ))}
    </Svg>
  );
}
