import React, { useId } from 'react';
import { Platform, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path, Rect, Text as SvgText, TextPath } from 'react-native-svg';

// A tournament's podium, drawn cartoon style (thick outlines, flat shading):
// the champion's trophy, and medals for the runner-up (silver) and third
// place (bronze), each lettered with the tournament's name and year. Table
// tennis (paddles, ball, net) and autumn (leaves, acorns) on every piece. The
// …Badge versions are for small sizes, without lettering or fine details.
// The lettering is Lilita One, loaded in App.tsx.

export const ART_FONT = 'LilitaOne_400Regular';
const FONT = Platform.OS === 'web' ? `${ART_FONT}, 'Arial Black', sans-serif` : ART_FONT;

const INK = '#2B160C';
const GOLD = '#F2B632';
const GOLD_SHADE = '#C98712';
const GOLD_LIGHT = '#FFE08A';
const WOOD = '#C9884E';
const RED = '#E8192C';
const BLACK = '#2D2A32';
const BALL = '#FF8A1F';
const LEAF_ORANGE = '#FF8A1F';
const LEAF_RED = '#D7381C';
const LEAF_YELLOW = '#FFC93C';
const WALNUT = '#5B3A26';
const RIBBON = '#C8102E';
const RIBBON_DARK = '#8E0A20';
const CREAM = '#FFF4DC';

// A maple leaf in a 100 x 100 box.
const LEAF =
  'M50 5 L57 20 L65 16 L62 36 L75 28 L80 34 L92 30 L86 48 L94 52 L72 68 L75 76 L54 72 L54 95 L46 95 ' +
  'L46 72 L25 76 L28 68 L6 52 L14 48 L8 30 L20 34 L25 28 L38 36 L35 16 L43 20 Z';
// The trophy's cup, in its 240 x 300 drawing.
const BODY = 'M70 102 C70 158 92 186 120 190 C148 186 170 158 170 102 Z';
// Twelve rays around (100, 100).
const RAYS =
  'M100 100 L199.1 86.9 L199.1 113.1 Z M100 100 L192.4 138.3 L179.3 160.9 Z M100 100 L160.9 179.3 L138.3 192.4 Z ' +
  'M100 100 L113.1 199.1 L86.9 199.1 Z M100 100 L61.7 192.4 L39.1 179.3 Z M100 100 L20.7 160.9 L7.6 138.3 Z ' +
  'M100 100 L0.9 113.1 L0.9 86.9 Z M100 100 L7.6 61.7 L20.7 39.1 Z M100 100 L39.1 20.7 L61.7 7.6 Z ' +
  'M100 100 L86.9 0.9 L113.1 0.9 Z M100 100 L138.3 7.6 L160.9 20.7 Z M100 100 L179.3 39.1 L192.4 61.7 Z';

// "AUTUMN OPEN 2026": what's lettered on a tournament's trophy and medals.
export function inscription(name: string, at: string | null | undefined): string {
  const year = at ? new Date(at).getFullYear() : NaN;
  return (Number.isFinite(year) ? `${name} ${year}` : name).toUpperCase();
}

// An id for this drawing's clip and text paths: on the web, every SVG on the
// page shares one set of ids.
function useArtId(): string {
  return `art${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
}

// The font size that fits `text` across `width` (Lilita One capitals are
// about 0.55em wide).
function fitFont(text: string, width: number, max: number, letterSpacing: number): number {
  const perChar = width / Math.max(1, text.length) - letterSpacing;
  return Math.max(5, Math.min(max, perChar / 0.55));
}

function Leaf({
  x,
  y,
  rotate = 0,
  scale,
  fill,
  stroke = INK,
  line = 2.9,
}: {
  x: number;
  y: number;
  rotate?: number;
  scale: number;
  fill: string;
  stroke?: string;
  line?: number;
}) {
  return (
    <Path
      transform={`translate(${x} ${y}) rotate(${rotate}) scale(${scale}) translate(-50 -50)`}
      d={LEAF}
      fill={fill}
      stroke={stroke}
      strokeWidth={line / scale}
      strokeLinejoin="round"
    />
  );
}

function Sparkle({ x, y, r, fill }: { x: number; y: number; r: number; fill: string }) {
  return (
    <Path
      d={`M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z`}
      fill={fill}
      stroke={INK}
      strokeWidth={2}
      strokeLinejoin="round"
    />
  );
}

function Acorn({ x, y, rotate }: { x: number; y: number; rotate: number }) {
  return (
    <G transform={`translate(${x} ${y}) rotate(${rotate})`}>
      <Ellipse cx={0} cy={4} rx={6.5} ry={8} fill="#C98A3E" stroke={INK} strokeWidth={3} />
      <Path d="M-8 0 C-8 -8 8 -8 8 0 Z" fill="#7A4A1C" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <Path d="M0 -6 L1.5 -11" fill="none" stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
    </G>
  );
}

// One image for screen readers, called `label`; without a label, hidden from
// them (the text beside it says what it is).
function Framed({ label, children }: { label?: string; children: React.ReactNode }) {
  return label ? (
    <View accessible accessibilityRole="image" accessibilityLabel={label}>
      {children}
    </View>
  ) : (
    <View aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {children}
    </View>
  );
}

// An outlined stroke: the ink first, the color on top.
function Stroke({ d, color, width, ink }: { d: string; color: string; width: number; ink: number }) {
  return (
    <>
      <Path d={d} fill="none" stroke={INK} strokeWidth={width + ink} strokeLinecap="round" />
      <Path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" />
    </>
  );
}

// The champion's trophy: a gold cup with an orange ball on its lid, crossed
// paddles behind it, a net around it, autumn leaves and acorns, and a ribbon
// with `text`. `size` is its width; it's 1.25 times as tall.
export function Trophy({ size, text, label }: { size: number; text: string; label?: string }) {
  const id = useArtId();
  const fontSize = fitFont(text, 148, 15, 0.8);
  const netLines = Array.from({ length: 17 }, (_, i) => `M${64 + i * 7} 128 V148`).join(' ');
  return (
    <Framed label={label}>
      <Svg width={size} height={size * 1.25} viewBox="0 0 240 300">
        <Defs>
          <ClipPath id={`${id}b`}>
            <Path d={BODY} />
          </ClipPath>
        </Defs>
        <Leaf x={26} y={34} rotate={-25} scale={0.16} fill={LEAF_YELLOW} />
        <Leaf x={216} y={40} rotate={30} scale={0.16} fill={LEAF_RED} />
        <Leaf x={222} y={186} rotate={70} scale={0.16} fill={LEAF_ORANGE} />
        <Leaf x={16} y={178} rotate={-60} scale={0.16} fill={LEAF_YELLOW} />
        <Sparkle x={44} y={106} r={8} fill="#FFF3C4" />
        <Sparkle x={204} y={11} r={7} fill="#FFF3C4" />

        <Stroke d="M66 96 L100 150" color={WOOD} width={10} ink={8} />
        <Circle cx={50} cy={76} r={28} fill={RED} stroke={INK} strokeWidth={4} />
        <Path d="M72.5 89 A26 26 0 0 1 37 98.5 A22 22 0 0 0 72.5 89 Z" fill="#A50E1D" />
        <Path d="M34 64 A20 20 0 0 1 56 56" fill="none" stroke="#FF7A86" strokeWidth={5} strokeLinecap="round" />
        <Stroke d="M174 96 L140 150" color={WOOD} width={10} ink={8} />
        <Circle cx={190} cy={76} r={28} fill={BLACK} stroke={INK} strokeWidth={4} />
        <Path d="M203 98.5 A26 26 0 0 1 167.5 89 A22 22 0 0 0 203 98.5 Z" fill="#17151B" />
        <Path d="M176 62 A20 20 0 0 1 198 56" fill="none" stroke="#5A5560" strokeWidth={5} strokeLinecap="round" />

        <Stroke d="M74 110 C42 98 32 134 54 148 C64 154 74 148 72 138" color={GOLD} width={8} ink={8} />
        <Stroke d="M166 110 C198 98 208 134 186 148 C176 154 166 148 168 138" color={GOLD} width={8} ink={8} />

        <Path d={BODY} fill={GOLD} />
        <G clipPath={`url(#${id}b)`}>
          <Path d="M140 102 C172 120 168 168 124 196 L180 196 L180 102 Z" fill={GOLD_SHADE} />
          <Path d="M84 110 C84 132 90 156 102 170" fill="none" stroke={GOLD_LIGHT} strokeWidth={6} strokeLinecap="round" />
          <Rect x={60} y={124} width={120} height={24} fill={BLACK} />
          <Path
            d={`${netLines} M60 135 H180 M60 142 H180`}
            fill="none"
            stroke="#F4F0EA"
            strokeOpacity={0.75}
            strokeWidth={1.2}
          />
          <Rect x={60} y={122} width={120} height={6} fill="#FFFFFF" />
          <Path d="M60 122 H180 M60 128 H180 M60 148 H180" fill="none" stroke={INK} strokeWidth={1.6} />
        </G>
        <Path d={BODY} fill="none" stroke={INK} strokeWidth={4} strokeLinejoin="round" />
        <Circle cx={120} cy={138} r={21} fill={GOLD} stroke={INK} strokeWidth={4} />
        <Circle cx={120} cy={138} r={15} fill="#FFF3DA" stroke={INK} strokeWidth={2.5} />
        <Leaf x={120} y={138} scale={0.22} fill={LEAF_ORANGE} line={2.4} />
        <Path d="M103.1 131.8 A18 18 0 0 1 112.4 121.7" fill="none" stroke={GOLD_LIGHT} strokeWidth={3} strokeLinecap="round" />

        <Rect x={62} y={92} width={116} height={12} rx={6} fill={GOLD} stroke={INK} strokeWidth={4} />
        <Path d="M72 96.5 H140" fill="none" stroke={GOLD_LIGHT} strokeWidth={2.5} strokeLinecap="round" />
        <Rect x={72} y={82} width={96} height={12} rx={6} fill={GOLD_SHADE} stroke={INK} strokeWidth={3.5} />
        <Path d="M78 84 C78 62 98 50 120 50 C142 50 162 62 162 84 Z" fill={GOLD} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
        <Path d="M132 53 C150 58 160 70 160 82 L142 82 C143 70 140 60 132 53 Z" fill={GOLD_SHADE} />
        <Path d="M92 74 C94 66 101 60 110 57" fill="none" stroke={GOLD_LIGHT} strokeWidth={4} strokeLinecap="round" />
        <Leaf x={104} y={48} rotate={-40} scale={0.17} fill={LEAF_RED} />
        <Leaf x={136} y={48} rotate={40} scale={0.17} fill={LEAF_YELLOW} />
        <Rect x={112} y={40} width={16} height={12} rx={3} fill={GOLD} stroke={INK} strokeWidth={3.5} />
        <Circle cx={120} cy={28} r={14} fill={BALL} stroke={INK} strokeWidth={4} />
        <Path d="M131.3 32.1 A12 12 0 0 1 115.9 39.3 A9.5 9.5 0 0 0 131.3 32.1 Z" fill="#D96A0B" />
        <Ellipse cx={114.5} cy={22.5} rx={4} ry={2.4} fill="#FFD9AE" transform="rotate(-30 114.5 22.5)" />

        <Path d="M106 188 H134 L128 210 H112 Z" fill={GOLD} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
        <Path d="M121 190 H131 L126.5 208 H121 Z" fill={GOLD_SHADE} />
        <Leaf x={100} y={201} rotate={-62} scale={0.17} fill={LEAF_ORANGE} />
        <Leaf x={140} y={201} rotate={62} scale={0.17} fill={LEAF_RED} />
        <Ellipse cx={120} cy={212} rx={19} ry={6.5} fill={GOLD} stroke={INK} strokeWidth={4} />
        <Path d="M86 236 C86 224 102 216 120 216 C138 216 154 224 154 236 Z" fill={GOLD} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
        <Path d="M124 218.5 C138 220.5 149 226 151.5 234 L134 234 C134 228 130 222 124 218.5 Z" fill={GOLD_SHADE} />
        <Rect x={72} y={232} width={96} height={10} rx={3} fill={GOLD_SHADE} stroke={INK} strokeWidth={3.5} />
        <Rect x={56} y={240} width={128} height={46} rx={9} fill={WALNUT} stroke={INK} strokeWidth={4} />
        <Rect x={61} y={245} width={118} height={5} rx={2.5} fill="#7A5236" />
        <Leaf x={50} y={232} rotate={-48} scale={0.2} fill={LEAF_YELLOW} />
        <Acorn x={64} y={240} rotate={-18} />
        <Leaf x={190} y={232} rotate={48} scale={0.2} fill={LEAF_ORANGE} />
        <Acorn x={176} y={240} rotate={18} />

        <Path d="M50 256 H18 L29 267.5 L18 279 H50 Z" fill={RIBBON_DARK} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
        <Path d="M190 256 H222 L211 267.5 L222 279 H190 Z" fill={RIBBON_DARK} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
        <Rect x={40} y={252} width={160} height={28} rx={4} fill={RIBBON} stroke={INK} strokeWidth={3.5} />
        <SvgText
          x={120}
          y={266 + fontSize * 0.35}
          textAnchor="middle"
          fontFamily={FONT}
          fontSize={fontSize}
          letterSpacing={0.8}
          fill={CREAM}
        >
          {text}
        </SvgText>
        <Sparkle x={212} y={113} r={7} fill="#FFFFFF" />
      </Svg>
    </Framed>
  );
}

// The trophy at small sizes (a list row, a podium line, a cabinet tile).
// `size` is its width.
export function TrophyBadge({ size, label }: { size: number; label?: string }) {
  const id = useArtId();
  const art = (
    <Svg width={size} height={(size * 284) / 212} viewBox="14 8 212 284">
      <Defs>
        <ClipPath id={`${id}b`}>
          <Path d={BODY} />
        </ClipPath>
      </Defs>
      <Stroke d="M66 96 L100 150" color={WOOD} width={10} ink={12} />
      <Circle cx={50} cy={76} r={28} fill={RED} stroke={INK} strokeWidth={8} />
      <Stroke d="M174 96 L140 150" color={WOOD} width={10} ink={12} />
      <Circle cx={190} cy={76} r={28} fill={BLACK} stroke={INK} strokeWidth={8} />
      <Stroke d="M74 110 C42 98 32 134 54 148 C64 154 74 148 72 138" color={GOLD} width={10} ink={12} />
      <Stroke d="M166 110 C198 98 208 134 186 148 C176 154 166 148 168 138" color={GOLD} width={10} ink={12} />
      <Path d={BODY} fill={GOLD} />
      <G clipPath={`url(#${id}b)`}>
        <Path d="M140 102 C172 120 168 168 124 196 L180 196 L180 102 Z" fill={GOLD_SHADE} />
        <Rect x={60} y={124} width={120} height={24} fill={BLACK} />
        <Rect x={60} y={120} width={120} height={8} fill="#FFFFFF" />
      </G>
      <Path d={BODY} fill="none" stroke={INK} strokeWidth={8} strokeLinejoin="round" />
      <Circle cx={120} cy={138} r={18} fill={LEAF_ORANGE} stroke={INK} strokeWidth={7} />
      <Path d="M78 96 C78 62 98 50 120 50 C142 50 162 62 162 96 Z" fill={GOLD} stroke={INK} strokeWidth={8} strokeLinejoin="round" />
      <Rect x={62} y={92} width={116} height={12} rx={6} fill={GOLD} stroke={INK} strokeWidth={7} />
      <Rect x={111} y={38} width={18} height={16} rx={3} fill={GOLD} stroke={INK} strokeWidth={7} />
      <Circle cx={120} cy={28} r={16} fill={BALL} stroke={INK} strokeWidth={8} />
      <Path d="M106 188 H134 L128 212 H112 Z" fill={GOLD} stroke={INK} strokeWidth={8} strokeLinejoin="round" />
      <Path d="M86 238 C86 224 102 216 120 216 C138 216 154 224 154 238 Z" fill={GOLD} stroke={INK} strokeWidth={8} strokeLinejoin="round" />
      <Rect x={56} y={236} width={128} height={50} rx={9} fill={WALNUT} stroke={INK} strokeWidth={8} />
      <Rect x={40} y={250} width={160} height={30} rx={4} fill={RIBBON} stroke={INK} strokeWidth={7} />
    </Svg>
  );
  return <Framed label={label}>{art}</Framed>;
}

type Place = 2 | 3;
const METAL: Record<
  Place,
  { base: string; shade: string; face: string; ring: string; text: string; leaf: string; leafLine: string; shine: string }
> = {
  2: {
    base: '#CBD5DE',
    shade: '#9AA7B4',
    face: '#E3E9EF',
    ring: '#5E6B78',
    text: '#44505C',
    leaf: '#CCD5DE',
    leafLine: '#8D9AA8',
    shine: '#FFFFFF',
  },
  3: {
    base: '#D08A4E',
    shade: '#A9632B',
    face: '#E9A774',
    ring: '#7A4119',
    text: '#5C2E0E',
    leaf: '#DC9A63',
    leafLine: '#A9632B',
    shine: '#FFE4CC',
  },
};

// The ribbon both medals hang from, in autumn colors.
function Straps({ ink }: { ink: number }) {
  return (
    <>
      <Path d="M26 4 H56 L82 96 L58 100 Z" fill={RIBBON_DARK} stroke={INK} strokeWidth={ink} strokeLinejoin="round" />
      <Path d="M41 7 L69 96" fill="none" stroke={LEAF_ORANGE} strokeWidth={7} />
      <Path d="M114 4 H84 L58 96 L82 100 Z" fill="#B3261E" stroke={INK} strokeWidth={ink} strokeLinejoin="round" />
      <Path d="M99 7 L71 96" fill="none" stroke={LEAF_YELLOW} strokeWidth={7} />
    </>
  );
}

// The place, white with an ink outline.
function Numeral({ place, y, size, ink }: { place: Place; y: number; size: number; ink: number }) {
  return (
    <>
      <SvgText
        x={70}
        y={y}
        textAnchor="middle"
        fontFamily={FONT}
        fontSize={size}
        fill={INK}
        stroke={INK}
        strokeWidth={ink}
        strokeLinejoin="round"
      >
        {String(place)}
      </SvgText>
      <SvgText x={70} y={y} textAnchor="middle" fontFamily={FONT} fontSize={size} fill="#FFFFFF">
        {String(place)}
      </SvgText>
    </>
  );
}

// The runner-up's (2: silver) or a third place's (3: bronze) medal, with
// `text` around the rim. `size` is its width; it's 10/7 as tall.
export function Medal({ place, size, text, label }: { place: Place; size: number; text: string; label?: string }) {
  const id = useArtId();
  const m = METAL[place];
  const rim = text.replace(/ (\d{4})$/, ' · $1');
  const fontSize = fitFont(rim, 190, 9.5, 0.8);
  return (
    <Framed label={label}>
      <Svg width={size} height={(size * 200) / 140} viewBox="0 0 140 200">
        <Defs>
          <Path id={`${id}r`} d="M27 146 A43 43 0 1 1 113 146 A43 43 0 1 1 27 146" />
          <ClipPath id={`${id}d`}>
            <Circle cx={70} cy={146} r={48} />
          </ClipPath>
        </Defs>
        <Straps ink={3.5} />
        <Stroke d="M40 170 L56 156" color={WOOD} width={6} ink={6} />
        <Circle cx={28} cy={182} r={15} fill={RED} stroke={INK} strokeWidth={3.5} />
        <Stroke d="M100 170 L84 156" color={WOOD} width={6} ink={6} />
        <Circle cx={112} cy={182} r={15} fill={BLACK} stroke={INK} strokeWidth={3.5} />
        <Rect x={60} y={92} width={20} height={12} rx={4} fill={m.base} stroke={INK} strokeWidth={3.5} />
        <Circle cx={70} cy={146} r={48} fill={m.base} />
        <G clipPath={`url(#${id}d)`}>
          <Path d="M118 136 C118 174 94 198 58 196 L130 200 L130 136 Z" fill={m.shade} />
        </G>
        <Circle cx={70} cy={146} r={48} fill="none" stroke={INK} strokeWidth={4} />
        <Circle cx={70} cy={146} r={35} fill={m.face} stroke={m.ring} strokeWidth={2.5} />
        <SvgText fontFamily={FONT} fontSize={fontSize} letterSpacing={0.8} fill={m.text} textAnchor="middle">
          <TextPath href={`#${id}r`} startOffset="25%">
            {rim}
          </TextPath>
        </SvgText>
        <Leaf x={70} y={146} scale={0.46} fill={m.leaf} stroke={m.leafLine} line={2.3} />
        <Numeral place={place} y={161} size={40} ink={6} />
        <Path d="M41.8 135.7 A30 30 0 0 1 55 120" fill="none" stroke={m.shine} strokeWidth={4} strokeLinecap="round" />
        <Sparkle x={118} y={111} r={7} fill="#FFFFFF" />
      </Svg>
    </Framed>
  );
}

// A medal at small sizes. `size` is its width.
export function MedalBadge({ place, size, label }: { place: Place; size: number; label?: string }) {
  const m = METAL[place];
  const art = (
    <Svg width={size} height={(size * 200) / 140} viewBox="0 0 140 200">
      <Path d="M26 4 H56 L82 96 L58 100 Z" fill={RIBBON_DARK} stroke={INK} strokeWidth={8} strokeLinejoin="round" />
      <Path d="M114 4 H84 L58 96 L82 100 Z" fill="#B3261E" stroke={INK} strokeWidth={8} strokeLinejoin="round" />
      <Circle cx={70} cy={146} r={48} fill={m.base} stroke={INK} strokeWidth={9} />
      <Circle cx={70} cy={146} r={33} fill={m.face} stroke={m.ring} strokeWidth={5} />
      <Numeral place={place} y={165} size={52} ink={10} />
    </Svg>
  );
  return <Framed label={label}>{art}</Framed>;
}

// Rays behind a trophy.
export function Sunburst({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Path d={RAYS} fill={color} />
    </Svg>
  );
}
