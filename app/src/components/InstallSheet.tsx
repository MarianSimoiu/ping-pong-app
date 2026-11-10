import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { BottomSheet, SheetButton, SheetHeader } from '@/components/BottomSheet';
import { useAuth } from '@/context/AuthContext';
import { closeInstall, promptInstall, snoozeInstall, useInstall } from '@/lib/install';
import { spacing, useTheme, type Colors } from '@/theme';

// The "Install Ping Pong" popup (web only). What it offers depends on the
// browser — see src/lib/install.ts.
export function InstallSheet() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { session } = useAuth();
  const { method, open, justInstalled } = useInstall();

  const dismiss = justInstalled ? closeInstall : snoozeInstall;
  // Nothing to show if the app got installed some other way meanwhile (e.g.
  // from the browser's own menu while this was open).
  const visible = open && (justInstalled || method !== null);

  return (
    <BottomSheet visible={visible} onDismiss={dismiss} nativeID="install-sheet">
      <SheetHeader
        icon={<Image source={{ uri: '/icon-192.png' }} style={styles.icon} />}
        title={justInstalled ? 'Installed 🎉' : 'Install Ping Pong'}
        subtitle={
          justInstalled
            ? 'Find Ping Pong on your home screen and open it from there.'
            : 'Get it on your home screen — it opens full screen, like a regular app.'
        }
      />

      {justInstalled ? (
        <SheetButton label="OK" onPress={closeInstall} />
      ) : method === 'prompt' ? (
        <>
          <SheetButton label="Install" onPress={promptInstall} />
          <SheetButton label="Not now" onPress={snoozeInstall} secondary />
        </>
      ) : method === 'ios' ? (
        <>
          <Step n={1} styles={styles} hint="On iOS 26 and later, tap ••• next to the address bar first.">
            <Text style={styles.stepText}>Tap the Share button</Text>
            <ShareGlyph color={colors.primary} />
          </Step>
          <Step n={2} styles={styles} hint="Tap View More if you don't see it.">
            <Text style={styles.stepText}>Scroll down and tap “Add to Home Screen”</Text>
          </Step>
          <Step n={3} styles={styles}>
            <Text style={styles.stepText}>Tap “Add”, then open Ping Pong from your home screen</Text>
          </Step>
          <Text style={styles.note}>
            Don't see these options? Open this page in Safari first.
            {session
              ? " If the new app asks you to sign in again, that's normal: it keeps its own login."
              : ''}
          </Text>
          <SheetButton label="Got it" onPress={snoozeInstall} />
        </>
      ) : method === 'firefox' ? (
        <>
          <Step n={1} styles={styles}>
            <Text style={styles.stepText}>Tap the ⋮ menu</Text>
          </Step>
          <Step n={2} styles={styles}>
            <Text style={styles.stepText}>Tap “Install” or “Add to Home screen”</Text>
          </Step>
          <Step n={3} styles={styles}>
            <Text style={styles.stepText}>Confirm, then open Ping Pong from your home screen</Text>
          </Step>
          <SheetButton label="Got it" onPress={snoozeInstall} />
        </>
      ) : null}
    </BottomSheet>
  );
}

type Styles = ReturnType<typeof createStyles>;

function Step({
  n,
  hint,
  styles,
  children,
}: {
  n: number;
  hint?: string;
  styles: Styles;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberText}>{n}</Text>
      </View>
      <View style={styles.stepBody}>
        <View style={styles.stepLine}>{children}</View>
        {hint && <Text style={styles.stepHint}>{hint}</Text>}
      </View>
    </View>
  );
}

// iOS's Share symbol (a box with an arrow pointing up), so step 1 matches
// what people see in Safari.
function ShareGlyph({ color }: { color: string }) {
  return (
    <Svg width={16} height={20} viewBox="0 0 16 20">
      <Path
        d="M5 7H2.5a1 1 0 0 0-1 1v9.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H11"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Path
        d="M8 12.5V1.5M4.5 5 8 1.5 11.5 5"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    icon: { width: 56, height: 56, borderRadius: 14 },
    step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    stepNumber: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepNumberText: { color: colors.text, fontSize: 13, fontWeight: '700' },
    stepBody: { flex: 1, paddingTop: 3 },
    stepLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
    stepText: { color: colors.text, fontSize: 15, flexShrink: 1 },
    stepHint: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
    note: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  });
}
