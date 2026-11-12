import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import { fetchBadges, fetchMyPlayerId } from '@/lib/badges';
import { DEFAULT_TIER_LINES, type PlayerBadge, type TierLine } from '@/lib/tiers';

type BadgesState = {
  badges: Record<string, PlayerBadge>;
  lines: TierLine[];
  meId: string | null;
  loaded: boolean;
  refresh: () => Promise<void>;
};

const BadgesContext = createContext<BadgesState | null>(null);

const REFRESH_MS = 5 * 60 * 1000;

// Everyone's tier, for the rings around avatars anywhere in the app. Loaded
// once signed in, then refreshed every few minutes, when the app comes back
// to the foreground, and after a result is recorded (refresh()).
export function BadgesProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [badges, setBadges] = useState<Record<string, PlayerBadge>>({});
  const [lines, setLines] = useState<TierLine[]>(DEFAULT_TIER_LINES);
  const [meId, setMeId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const [result, me] = await Promise.all([fetchBadges(), fetchMyPlayerId(userId)]);
      setBadges(result.badges);
      if (result.lines.length > 0) setLines(result.lines);
      setMeId(me);
      setLoaded(true);
    } catch {
      // Rings are decoration: keep what we had.
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setBadges({});
      setMeId(null);
      setLoaded(false);
      return;
    }
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    const onForeground = () => {
      if (Platform.OS !== 'web' || document.visibilityState === 'visible') refresh();
    };
    let cleanup: () => void;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onForeground);
      cleanup = () => document.removeEventListener('visibilitychange', onForeground);
    } else {
      const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
      cleanup = () => sub.remove();
    }
    return () => {
      clearInterval(timer);
      cleanup();
    };
  }, [userId, refresh]);

  const value = useMemo(() => ({ badges, lines, meId, loaded, refresh }), [badges, lines, meId, loaded, refresh]);
  return <BadgesContext.Provider value={value}>{children}</BadgesContext.Provider>;
}

export function useBadges(): BadgesState {
  return (
    useContext(BadgesContext) ?? {
      badges: {},
      lines: DEFAULT_TIER_LINES,
      meId: null,
      loaded: false,
      refresh: async () => {},
    }
  );
}

export function useBadge(playerId: string | null | undefined): PlayerBadge | null {
  const { badges } = useBadges();
  return playerId ? badges[playerId] ?? null : null;
}
