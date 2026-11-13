import React, { useMemo } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, spacing, useTheme, type Colors } from '@/theme';

// A panel that pops up from the bottom of the screen over a dimmed backdrop,
// closed by tapping outside it or pressing Escape. Used by the install and
// notification popups (InstallSheet, PushPromptSheet) and a tournament
// match's time and organizer actions (MatchSheets).
export function BottomSheet({
  visible,
  onDismiss,
  nativeID,
  children,
}: {
  visible: boolean;
  onDismiss: () => void;
  // Lets public/index.html hide the panel's focus ring.
  nativeID: string;
  children: React.ReactNode;
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        {/* Tap outside to close. A touch handler, not a Pressable, so it isn't
            focusable: the popup's focus would otherwise start on this
            screen-sized backdrop (Escape closes it from the keyboard). */}
        <View
          style={StyleSheet.absoluteFill}
          onStartShouldSetResponder={() => true}
          onResponderRelease={onDismiss}
        />
        {/* Focusable (but not a tab stop) so the popup's focus trap lands on
            the panel itself; index.html hides its focus ring. Otherwise the
            first button would open with a focus ring on it. */}
        <View
          nativeID={nativeID}
          tabIndex={-1}
          style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}
        >
          {children}
        </View>
      </View>
    </Modal>
  );
}

export function SheetHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.header}>
      {icon}
      <View style={styles.headerText}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

export function SheetButton({
  label,
  onPress,
  secondary,
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  busy?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      style={[secondary ? styles.secondaryButton : styles.button, busy && styles.busy, disabled && styles.disabled]}
      onPress={onPress}
      disabled={busy || disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(busy || disabled) }}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? colors.textMuted : colors.primaryText} />
      ) : (
        <Text style={secondary ? styles.secondaryButtonText : styles.buttonText}>{label}</Text>
      )}
    </Pressable>
  );
}

function useStyles() {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [colors]);
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
    headerText: { flex: 1 },
    title: { color: colors.text, fontSize: 20, fontWeight: '700' },
    subtitle: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginTop: 2 },
    button: {
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
    secondaryButton: { paddingVertical: spacing.sm, alignItems: 'center' },
    secondaryButtonText: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
    busy: { opacity: 0.7 },
    disabled: { opacity: 0.45 },
  });
}
