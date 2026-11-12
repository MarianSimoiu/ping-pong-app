import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BottomSheet, SheetButton, SheetHeader } from '@/components/BottomSheet';
import { useAuth } from '@/context/AuthContext';
import { installPopupThisVisit } from '@/lib/install';
import { showAlert } from '@/lib/platformAlert';
import { tierPopupThisVisit } from '@/components/TierCelebration';
import { titlePopupThisVisit } from '@/components/TitleCelebration';
import { getPushStatus, markPushPromptShown, pushPromptSnoozed, snoozePushPrompt, turnOnPush } from '@/lib/push';
import { radius, useTheme, type Colors } from '@/theme';

// Let the app settle before the popup slides in (the install popup, when due,
// comes at 3 s; this one stays away from that visit).
const OPEN_DELAY_MS = 4000;

// "Turn on notifications?" (web only): a few seconds after the app opens, for
// a signed-in player whose notifications are off on this device. Not shown
// while snoozed ("Not now": 3 days), once they're on, when they're blocked or
// unsupported (Profile explains those), or in a visit with the install or
// tier popup.
// The Notifications switch in Profile does the same thing.
export function PushPromptSheet() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { session, recovering } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const userId = session?.user.id;

  useEffect(() => {
    if (!userId || recovering) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (installPopupThisVisit() || tierPopupThisVisit() || titlePopupThisVisit() || pushPromptSnoozed()) return;
      const status = await getPushStatus().catch(() => 'unsupported');
      if (cancelled || status !== 'off' || tierPopupThisVisit() || titlePopupThisVisit()) return;
      markPushPromptShown();
      setOpen(true);
    }, OPEN_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [userId, recovering]);

  function notNow() {
    snoozePushPrompt();
    setOpen(false);
  }

  async function turnOn() {
    if (!userId) return;
    setBusy(true);
    try {
      // Shows the browser's own "Allow notifications?" first; this tap counts.
      const status = await turnOnPush(userId);
      setOpen(false);
      if (status === 'on') {
        showAlert('Notifications are on', 'You can turn them off any time in Profile.');
      } else if (status === 'blocked') {
        showAlert('Notifications blocked', 'You can allow them for this app in your browser or phone settings.');
      } else {
        snoozePushPrompt(); // they closed the browser's prompt: ask again in a few days
      }
    } catch (e) {
      setOpen(false);
      snoozePushPrompt();
      showAlert('Couldn’t turn on notifications', e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet visible={open} onDismiss={busy ? () => {} : notNow} nativeID="push-sheet">
      <SheetHeader
        icon={
          <View style={styles.icon}>
            <Text style={styles.bell}>🔔</Text>
          </View>
        }
        title="Turn on notifications?"
        subtitle="Get told when someone records a match against you, and when a match you recorded is confirmed or declined."
      />
      <SheetButton label="Turn on" onPress={turnOn} busy={busy} />
      {!busy && <SheetButton label="Not now" onPress={notNow} secondary />}
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
    bell: { fontSize: 28 },
  });
}
