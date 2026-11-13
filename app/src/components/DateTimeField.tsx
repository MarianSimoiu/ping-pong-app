import React, { useMemo } from 'react';
import { Platform, StyleSheet, TextInput } from 'react-native';

import { radius, spacing, useTheme, type Colors } from '@/theme';

// A date-and-time field (the tournament kickoff). `value` is local time as
// "2026-11-15T18:00" (toLocalInputValue in lib/countdown.ts); with
// mode="date", just the day: "2026-11-15" (a round's dates). On the web — the
// app as people use it — it's the browser's own picker (a wheel on iPhone, a
// calendar on desktop); elsewhere a plain "YYYY-MM-DD HH:MM" text field.
export function DateTimeField({
  value,
  onChange,
  min,
  label,
  mode = 'datetime',
}: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  label: string;
  mode?: 'datetime' | 'date';
}) {
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (Platform.OS === 'web') {
    return React.createElement('input', {
      type: mode === 'date' ? 'date' : 'datetime-local',
      value,
      min,
      'aria-label': label,
      className: 'datetime-field',
      onChange: (e: { target: { value: string } }) => onChange(e.target.value),
      style: {
        boxSizing: 'border-box',
        display: 'block',
        width: '100%',
        minHeight: 52,
        margin: 0,
        backgroundColor: colors.surfaceAlt,
        color: colors.text,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.md,
        padding: `${spacing.md - 2}px ${spacing.md}px`,
        fontSize: 16, // 16px keeps iOS from zooming in on focus
        // The font React Native Web gives text and text fields.
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        textAlign: 'left',
        colorScheme: scheme, // the picker and its icon follow the app's theme
      },
    });
  }

  return (
    <TextInput
      style={styles.input}
      accessibilityLabel={label}
      placeholder={mode === 'date' ? '2026-11-15' : '2026-11-15 18:00'}
      placeholderTextColor={colors.textMuted}
      autoCapitalize="none"
      autoCorrect={false}
      value={value.replace('T', ' ')}
      onChangeText={(v) => onChange(v.replace(' ', 'T'))}
    />
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    input: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      color: colors.text,
      fontSize: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
  });
}
