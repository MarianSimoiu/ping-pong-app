import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BottomSheet, SheetButton, SheetHeader } from '@/components/BottomSheet';
import { tierPopupThisVisit } from '@/components/TierCelebration';
import { useAuth } from '@/context/AuthContext';
import { useBadges } from '@/context/BadgesContext';
import { fetchTrophies, type EarnedTitle } from '@/lib/achievements';
import { installPopupThisVisit } from '@/lib/install';
import { pushPromptThisVisit } from '@/lib/push';
import { navigationRef } from '@/navigation/RootNavigator';
import { radius, useTheme, type Colors } from '@/theme';

// The titles this device has shown the player, per player.
const seenKey = (playerId: string) => `pingpong.titles.seen.${playerId}`;
function readSeen(playerId: string): string[] | null {
  try {
    const v = globalThis.localStorage?.getItem(seenKey(playerId));
    return v ? (JSON.parse(v) as string[]) : null;
  } catch {
    return null;
  }
}
function writeSeen(playerId: string, titles: string[]) {
  try {
    globalThis.localStorage?.setItem(seenKey(playerId), JSON.stringify(titles));
  } catch {
    // Private mode: it shows again next time, no harm.
  }
}

let shownThisVisit = false;
export const titlePopupThisVisit = () => shownThisVisit;

// "New title: Giant Slayer": once per device for titles the player earned
// since they last saw them (at first, everything they've already earned).
// Waits for the next visit if another popup showed in this one.
export function TitleCelebration() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { recovering } = useAuth();
  const { meId, loaded, badges } = useBadges();
  const [fresh, setFresh] = useState<EarnedTitle[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Checked whenever the badges refresh (after a result, every few minutes).
  useEffect(() => {
    if (!loaded || !meId || recovering || shownThisVisit) return;
    let live = true;
    fetchTrophies(meId)
      .then((t) => {
        if (!live) return;
        const seen = readSeen(meId) ?? [];
        const unseen = t.titles.filter((x) => !seen.includes(x.title));
        if (unseen.length === 0) return;
        timer.current = setTimeout(() => {
          if (!live || installPopupThisVisit() || pushPromptThisVisit() || tierPopupThisVisit()) return;
          shownThisVisit = true;
          setFresh(unseen);
        }, 2500);
      })
      .catch(() => {});
    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [loaded, meId, recovering, badges]);

  function close(openProfile: boolean) {
    if (meId && fresh) writeSeen(meId, [...(readSeen(meId) ?? []), ...fresh.map((f) => f.title)]);
    setFresh(null);
    if (openProfile && navigationRef.isReady()) navigationRef.navigate('Profile', { screen: 'Account' });
  }

  if (!fresh) return null;
  const champion = fresh.find((f) => f.title.startsWith('champion:'));
  const title = champion
    ? `${champion.label} 🏆`
    : fresh.length === 1
      ? `New title: ${fresh[0].label}`
      : `${fresh.length} new titles`;
  const subtitle =
    fresh.length === 1
      ? 'Show it under your name from your profile.'
      : `${fresh.map((f) => f.label).join(', ')}. Pick one to show under your name.`;

  return (
    <BottomSheet visible onDismiss={() => close(false)} nativeID="title-sheet">
      <SheetHeader
        icon={
          <View style={styles.icon}>
            <Text style={styles.emoji}>{champion ? '🏆' : '🎖️'}</Text>
          </View>
        }
        title={title}
        subtitle={subtitle}
      />
      <SheetButton label="Choose my title" onPress={() => close(true)} />
      <SheetButton label="Later" onPress={() => close(false)} secondary />
    </BottomSheet>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    icon: {
      width: 56,
      height: 56,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emoji: { fontSize: 28 },
  });
}
