// Shared design tokens. "Paddle Red" theme: the classic table-tennis red, on
// a clean white-and-near-black ground (light) or a warm near-black ground
// (dark), with a gold accent for flourishes. Every foreground/background
// pair below has been checked against WCAG AA (>=4.5:1 for text, >=3:1 for
// borders/UI boundaries) — recheck with the same method before changing any
// value here.

import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

export type Colors = {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryText: string; // text on `primary` (also used on `success`/`danger` badges)
  accent: string;
  accentText: string; // text on `accent` — kept separate from primaryText because
  // accent stays light/bright in both themes, while primary doesn't
  success: string;
  danger: string;
};

const lightColors: Colors = {
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
  accentText: '#211A1B',
  success: '#1C8037',
  danger: '#7C1D1D', // deep brick/maroon — still reads "loss," but clearly
  // darker and less saturated than the vivid primary red so a Loss badge
  // and a primary CTA never get confused for each other
};

const darkColors: Colors = {
  background: '#181314', // warm near-black, not pure black — mirrors the
  // light theme's "near-white/near-black, never pure" philosophy
  surface: '#221C1D',
  surfaceAlt: '#2E1C1E',
  border: '#85696C', // lightened well past the background/surface tones so
  // card and input borders stay visible on a dark ground (>=3:1)
  text: '#F2E9E8', // warm near-white, not pure white
  textMuted: '#AD9F9D',
  primary: '#FF4B5C', // brightened from the light theme's red so it still
  // pops, and still reads clearly, against a dark ground
  primaryText: '#1A0D0E', // flips to near-black here: the brightened badge
  // colors (primary/success/danger) are light enough on a dark ground that
  // dark text reads better than light text
  accent: '#E0AC2B',
  accentText: '#1A0D0E',
  success: '#4CAF60',
  danger: '#E08177', // muted terracotta — kept clearly less saturated than
  // the vivid primary so a Loss badge and a primary CTA stay distinct
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

export const radius = { sm: 14, md: 20, lg: 28 };

type Theme = {
  colors: Colors;
  scheme: 'light' | 'dark';
  // Status bar icon color for the OS chrome — not derived from `colors`
  // because expo-status-bar takes a literal 'light'/'dark', not a hex value.
  statusBarStyle: 'light' | 'dark';
};

const ThemeContext = createContext<Theme>({
  colors: lightColors,
  scheme: 'light',
  statusBarStyle: 'dark',
});

// Follows the OS light/dark setting automatically — no in-app toggle (yet).
export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const scheme: 'light' | 'dark' = systemScheme === 'dark' ? 'dark' : 'light';
  const value = useMemo<Theme>(
    () => ({
      colors: scheme === 'dark' ? darkColors : lightColors,
      scheme,
      statusBarStyle: scheme === 'dark' ? 'light' : 'dark',
    }),
    [scheme],
  );
  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
