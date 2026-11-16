import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { radius, spacing, useTheme, type Colors } from '@/theme';

export type TabItem<K extends string> = {
  key: K;
  label: string;
  // A number beside the label; none when left out.
  count?: number;
  // The count stands out: something there waits on the viewer.
  alert?: boolean;
};

// A row of tabs, one shown at a time (Titles | Trophies on a profile; Stats |
// History | Pending | Awards on your own). Up to three share the row equally;
// with more, each is as wide as its label and they share what's left, so a
// longer one ("Pending 5") still fits on a narrow phone; on one too narrow for
// them all (320 px), the row scrolls sideways. The caller renders the active
// tab's content.
export function SegmentedTabs<K extends string>({
  items,
  active,
  onChange,
}: {
  items: TabItem<K>[];
  active: K;
  onChange: (key: K) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const fit = items.length > 3;
  const tabs = items.map((item) => {
    const on = item.key === active;
    return (
      <Pressable
        key={item.key}
        style={[styles.tab, fit ? styles.tabFit : styles.tabEqual, on && styles.tabActive]}
        onPress={() => onChange(item.key)}
        accessibilityRole="tab"
        aria-selected={on}
      >
        <Text style={[styles.tabText, on && styles.tabTextActive]} numberOfLines={1}>
          {item.label}
        </Text>
        {item.count !== undefined && (
          <View style={[styles.tabCount, item.alert && styles.tabCountAlert, on && styles.tabCountActive]}>
            <Text style={[styles.tabCountText, (on || item.alert) && styles.tabTextActive]}>{item.count}</Text>
          </View>
        )}
      </Pressable>
    );
  });
  return fit ? (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroller}
      contentContainerStyle={styles.tabsFit}
      accessibilityRole="tablist"
    >
      {tabs}
    </ScrollView>
  ) : (
    <View style={styles.tabs} accessibilityRole="tablist">
      {tabs}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    tabs: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    scroller: { flexGrow: 0, marginBottom: spacing.md },
    // At least as wide as the screen, so the tabs grow to fill it when they fit.
    tabsFit: { flexGrow: 1, flexDirection: 'row', gap: spacing.sm },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    tabEqual: { flex: 1 },
    tabFit: { flexGrow: 1, flexShrink: 0, flexBasis: 'auto', paddingHorizontal: spacing.sm },
    tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    tabText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
    tabTextActive: { color: colors.primaryText },
    tabCount: {
      minWidth: 20,
      paddingHorizontal: 5,
      borderRadius: 10,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
    },
    tabCountAlert: { backgroundColor: colors.primary },
    tabCountActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
    tabCountText: { color: colors.textMuted, fontSize: 12, fontWeight: '700', lineHeight: 18 },
  });
}
