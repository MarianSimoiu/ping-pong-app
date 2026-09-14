// Shared design tokens. "Bubblegum" theme: a light candy palette — bubblegum
// pink and mint on a warm off-white ground — with rounder, bouncier shapes.

export const colors = {
  background: '#FFF7FA',
  surface: '#FFFFFF',
  surfaceAlt: '#FFEAF3',
  border: '#F3D6E4',
  text: '#2B1D26', // deep plum-black, warmer/softer than pure black
  textMuted: '#8B7A85',
  primary: '#FF5FA2', // bubblegum pink — CTAs, active states, the rating chart
  primaryText: '#FFFFFF',
  accent: '#12A385', // deepened mint — medals, streaks, hype tags; kept dark
  // enough to stay legible as small text on this light ground (a pale candy
  // mint washes out here the way it wouldn't on a dark background)
  success: '#1FA35A', // likewise deepened for light-background contrast
  danger: '#E2483C', // warm coral-red, kept clearly apart in hue from the pink primary
};

// Status bar icon color for the OS chrome — not derived from `colors` above
// because expo-status-bar takes a literal 'light'/'dark', not a hex value.
// Every screen that renders <StatusBar> should reference this constant
// instead of hardcoding a style, so a future theme swap can't miss it.
export const statusBarStyle: 'light' | 'dark' = 'dark';

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 14,
  md: 20,
  lg: 28,
};
