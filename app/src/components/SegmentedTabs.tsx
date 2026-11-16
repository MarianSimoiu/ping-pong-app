import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, spacing, useTheme, type Colors } from '@/theme';

export type TabItem<K extends string> = {
  key: K;
  label: string;
  // A number beside the label; none when left out.
  count?: number;
  // The count stands out: something there waits on the viewer.
  alert?: boolean;
};

// A row of equal tabs, one shown at a time (Titles | Trophies on a profile;
// Stats | History | Pending on your own). The caller renders the active one.
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
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {items.map((item) => {
        const on = item.key === active;
        return (
          <Pressable
            key={item.key}
            style={[styles.tab, on && styles.tabActive]}
            onPress={() => onChange(item.key)}
            accessibilityRole="tab"
            aria-selected={on}
          >
            <Text style={[styles.tabText, on && styles.tabTextActive]}>{item.label}</Text>
            {item.count !== undefined && (
              <View style={[styles.tabCount, item.alert && styles.tabCountAlert, on && styles.tabCountActive]}>
                <Text style={[styles.tabCountText, (on || item.alert) && styles.tabTextActive]}>{item.count}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    tabs: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    tab: {
      flex: 1,
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
