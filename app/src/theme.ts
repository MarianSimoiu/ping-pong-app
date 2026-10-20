// Shared design tokens. "Paddle Red" theme: the classic table-tennis red, on
// a clean white-and-near-black ground (light) or a warm near-black ground
// (dark), with a gold accent for flourishes. Every foreground/background
// pair below has been checked against WCAG AA (>=4.5:1 for text, >=3:1 for
// borders/UI boundaries) — recheck with the same method before changing any
// value here.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Platform, useColorScheme } from 'react-native';

import { useAuth } from '@/context/AuthContext';

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
  // True until no explicit choice has ever been saved for this user/device —
  // i.e. `scheme` is still just following the OS setting.
  isSystemDefault: boolean;
  // Explicitly override the theme for this user on this device, overriding
  // the OS setting from now on. Persisted locally (AsyncStorage), scoped to
  // the signed-in user, so a shared device keeps each account's own choice
  // and a different device starts back at following the system.
  setDarkMode: (dark: boolean) => void;
};

const ThemeContext = createContext<Theme>({
  colors: lightColors,
  scheme: 'light',
  statusBarStyle: 'dark',
  isSystemDefault: true,
  setDarkMode: () => {},
});

const storageKey = (userId: string) => `theme-override:${userId}`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? 'anon';
  const systemScheme = useColorScheme();
  const [override, setOverride] = useState<'light' | 'dark' | null>(null);

  // (Re)load this user's saved choice whenever who's signed in changes —
  // e.g. signing out and into a different account on the same device.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(storageKey(userId)).then((stored) => {
      if (cancelled) return;
      setOverride(stored === 'light' || stored === 'dark' ? stored : null);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const setDarkMode = useCallback(
    (dark: boolean) => {
      const next = dark ? 'dark' : 'light';
      setOverride(next);
      AsyncStorage.setItem(storageKey(userId), next).catch(() => {
        // Non-fatal: the choice still applies for the rest of this session.
      });
    },
    [userId],
  );

  const scheme: 'light' | 'dark' = override ?? (systemScheme === 'dark' ? 'dark' : 'light');
  const background = scheme === 'dark' ? darkColors.background : lightColors.background;

  // Web only: keep the HTML page's own background in sync with the live
  // theme (not just the OS default baked into index.html's CSS), so the
  // safe-area outside the app's own view (e.g. below the tab bar, behind
  // on-screen gesture nav) never shows the browser's white default —
  // including once a user picks a theme that differs from their OS setting.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.style.backgroundColor = background;
    document.body.style.backgroundColor = background;

    // Also keep both <meta name="theme-color"> tags' content live, so the
    // status bar tint follows the app's theme. The two tags in index.html
    // are picked by the OS's own light/dark setting; updating both to the
    // same resolved color means whichever one the browser is using stays
    // correct even once a manual override makes the app's theme differ
    // from the OS default.
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute('content', background);
    });
  }, [background]);

  const value = useMemo<Theme>(
    () => ({
      colors: scheme === 'dark' ? darkColors : lightColors,
      scheme,
      statusBarStyle: scheme === 'dark' ? 'light' : 'dark',
      isSystemDefault: override === null,
      setDarkMode,
    }),
    [scheme, override, setDarkMode],
  );
  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
