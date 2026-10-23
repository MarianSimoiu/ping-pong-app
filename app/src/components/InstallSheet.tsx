import React, { useMemo } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { useAuth } from '@/context/AuthContext';
import { closeInstall, promptInstall, snoozeInstall, useInstall } from '@/lib/install';
import { radius, spacing, useTheme, type Colors } from '@/theme';

// The "Install Ping Pong" popup (web only). What it offers depends on the
// browser — see src/lib/install.ts.
export function InstallSheet() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { method, open, justInstalled } = useInstall();

  const dismiss = justInstalled ? closeInstall : snoozeInstall;
  // Nothing to show if the app got installed some other way meanwhile (e.g.
  // from the browser's own menu while this was open).
  const visible = open && (justInstalled || method !== null);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        {/* Tap outside to close. A touch handler, not a Pressable, so it isn't
            focusable: the popup's focus would otherwise start on this
            screen-sized backdrop (Escape closes it from the keyboard). */}
        <View
          style={StyleSheet.absoluteFill}
          onStartShouldSetResponder={() => true}
          onResponderRelease={dismiss}
        />
        {/* Focusable (but not a tab stop) so the popup's focus trap lands on
            the panel itself; index.html hides its focus ring. Otherwise the
            first button would open with a focus ring on it. */}
        <View
          nativeID="install-sheet"
          tabIndex={-1}
          style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}
        >
          <View style={styles.header}>
            <Image source={{ uri: '/icon-192.png' }} style={styles.icon} />
            <View style={styles.headerText}>
              <Text style={styles.title}>{justInstalled ? 'Installed 🎉' : 'Install Ping Pong'}</Text>
              <Text style={styles.subtitle}>
                {justInstalled
                  ? 'Find Ping Pong on your home screen and open it from there.'
                  : 'Get it on your home screen — it opens full screen, like a regular app.'}
              </Text>
            </View>
          </View>

          {justInstalled ? (
            <Button label="OK" onPress={closeInstall} styles={styles} />
          ) : method === 'prompt' ? (
            <>
              <Button label="Install" onPress={promptInstall} styles={styles} />
              <Button label="Not now" onPress={snoozeInstall} styles={styles} secondary />
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
              <Button label="Got it" onPress={snoozeInstall} styles={styles} />
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
              <Button label="Got it" onPress={snoozeInstall} styles={styles} />
            </>
          ) : null}
        </View>
      </View>
    </Modal>
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

function Button({
  label,
  onPress,
  styles,
  secondary,
}: {
  label: string;
  onPress: () => void;
  styles: Styles;
  secondary?: boolean;
}) {
  return (
    <Pressable
      style={secondary ? styles.secondaryButton : styles.button}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text style={secondary ? styles.secondaryButtonText : styles.buttonText}>{label}</Text>
    </Pressable>
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
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.5)' },
    sheet: {
      width: '100%',
      maxWidth: 520,
      alignSelf: 'center',
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.lg,
      gap: spacing.md,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    icon: { width: 56, height: 56, borderRadius: 14 },
    headerText: { flex: 1 },
    title: { color: colors.text, fontSize: 20, fontWeight: '700' },
    subtitle: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginTop: 2 },
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
    button: {
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
    secondaryButton: { paddingVertical: spacing.sm, alignItems: 'center' },
    secondaryButtonText: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
  });
}
