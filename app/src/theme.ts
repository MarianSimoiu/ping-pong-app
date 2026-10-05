// Shared design tokens. "Paddle Red" theme: the classic table-tennis red,
// on a clean white-and-near-black ground, with a gold accent for flourishes.

export const colors = {
  background: '#FAFAFA',
  surface: '#FFFFFF',
  surfaceAlt: '#FDEDEE', // soft red-tinted alt surface
  border: '#F0D5D7',
  text: '#211A1B', // warm near-black, not pure black
  textMuted: '#8A7678',
  primary: '#E8192C', // paddle red — CTAs, active states, the rating chart
  primaryText: '#FFFFFF',
  accent: '#B8860B', // medal gold — deepened (not a pale/washed gold) so it
  // stays legible as small text on this light ground
  success: '#1F8A3B',
  danger: '#7C1D1D', // deep brick/maroon — still reads "loss," but clearly
  // darker and less saturated than the vivid primary red so a Loss badge
  // and a primary CTA never get confused for each other
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
