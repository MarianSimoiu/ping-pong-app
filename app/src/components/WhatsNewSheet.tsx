import { CommonActions } from '@react-navigation/native';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet, SheetButton, SheetHeader } from '@/components/BottomSheet';
import { tierPopupThisVisit } from '@/components/TierCelebration';
import { titlePopupThisVisit } from '@/components/TitleCelebration';
import { useAuth } from '@/context/AuthContext';
import { installSheetOpen } from '@/lib/install';
import { pushPromptThisVisit } from '@/lib/push';
import { dueUpdate, markUpdateSeen, markWhatsNewShown, requestChallengesCard, type Update } from '@/lib/whatsNew';
import { navigationRef } from '@/navigation/RootNavigator';
import { radius, spacing, useTheme, type Colors } from '@/theme';

// Soon after the app opens, ahead of the other popups (the tier one comes at
// about 1.2 s after the badges load, install at 3 s, notifications at 4 s).
const OPEN_DELAY_MS = 1500;

// "What's new" (web only, like the other popups): the latest update
// (lib/whatsNew.ts), once per player on this device, closed with Got it, ✕,
// a tap outside or Escape. Its button takes them to the feature. If another
// popup is already up, it waits for the next visit.
export function WhatsNewSheet() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { session, recovering } = useAuth();
  const [update, setUpdate] = useState<Update | null>(null);
  const userId = session?.user.id;

  useEffect(() => {
    if (!userId || recovering) return;
    const due = dueUpdate(userId);
    if (!due) return;
    const timer = setTimeout(() => {
      if (installSheetOpen() || tierPopupThisVisit() || titlePopupThisVisit() || pushPromptThisVisit()) return;
      markWhatsNewShown();
      setUpdate(due);
    }, OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [userId, recovering]);

  function close(go: boolean) {
    if (userId && update) markUpdateSeen(userId, update.id);
    const to = update?.action?.to;
    setUpdate(null);
    if (go && to === 'challenges' && navigationRef.isReady()) {
      // The Home tab (or, in it, the Home screen), scrolled to the card.
      requestChallengesCard();
      navigationRef.dispatch(CommonActions.navigate({ name: 'Home' }));
    }
  }

  if (!update) return null;
  return (
    <BottomSheet visible onDismiss={() => close(false)} nativeID="whats-new-sheet">
      <View style={styles.headerWrap}>
        <SheetHeader
          icon={
            <View style={styles.icon}>
              <Text style={styles.emoji}>{update.emoji}</Text>
            </View>
          }
          title={update.title}
          subtitle={update.subtitle}
        />
      </View>
      <Pressable
        style={styles.close}
        onPress={() => close(false)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Close"
      >
        <Text style={styles.closeText}>✕</Text>
      </Pressable>
      <View style={styles.points}>
        {update.points.map((p) => (
          <View key={p.text} style={styles.point}>
            <Text style={styles.pointIcon}>{p.icon}</Text>
            <Text style={styles.pointText}>{p.text}</Text>
          </View>
        ))}
      </View>
      {update.action && <SheetButton label={update.action.label} onPress={() => close(true)} />}
      <SheetButton label="Got it" onPress={() => close(false)} secondary={!!update.action} />
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
    headerWrap: { paddingRight: spacing.lg }, // room for the ✕
    close: {
      position: 'absolute',
      top: spacing.sm,
      right: spacing.sm,
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeText: { color: colors.textMuted, fontSize: 16, fontWeight: '700' },
    points: { gap: spacing.sm },
    point: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
    pointIcon: { fontSize: 18, lineHeight: 22, width: 24, textAlign: 'center' },
    pointText: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 20 },
  });
}
