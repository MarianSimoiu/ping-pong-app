import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useBadge, useBadges } from '@/context/BadgesContext';
import { fetchTrophies, setTitle, type Trophies } from '@/lib/achievements';
import { showAlert } from '@/lib/platformAlert';
import { radius, spacing, useTheme, type Colors } from '@/theme';

const monthYear = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

// A player's titles and trophies: every achievement with their progress,
// their tournament honours, and (on their own profile) which earned title to
// show under their name.
export function TrophyCabinet({ playerId, isMe }: { playerId: string; isMe: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const badge = useBadge(playerId);
  const { refresh } = useBadges();
  const [trophies, setTrophies] = useState<Trophies | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      fetchTrophies(playerId)
        .then((t) => live && setTrophies(t))
        .catch(() => {});
      return () => {
        live = false;
      };
    }, [playerId]),
  );

  async function choose(title: string | null) {
    setSaving(title ?? 'none');
    try {
      await setTitle(playerId, title);
      await refresh();
    } catch (e) {
      showAlert("Couldn't change your title", e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setSaving(null);
    }
  }

  if (!trophies) return <ActivityIndicator color={colors.textMuted} style={{ marginVertical: spacing.md }} />;

  const shown = badge?.title ?? null;
  const earnedCount = trophies.titles.length;
  const showButton = (title: string) =>
    isMe ? (
      <Pressable
        accessibilityRole="button"
        style={[styles.pill, shown === title && styles.pillOn]}
        onPress={() => choose(shown === title ? null : title)}
        disabled={saving !== null}
      >
        {saving === title ? (
          <ActivityIndicator size="small" color={colors.primaryText} />
        ) : (
          <Text style={[styles.pillText, shown === title && styles.pillTextOn]}>
            {shown === title ? '✓ Showing' : 'Show'}
          </Text>
        )}
      </Pressable>
    ) : null;

  const wins = trophies.honours.filter((h) => h.won);
  const finals = trophies.honours;

  // Earned ones first (newest first), then the closest to done; collapsed to
  // those plus the 3 closest until "See all".
  const items = trophies.catalog
    .filter((a) => a.code !== 'champion')
    .map((a) => {
      const isFinalist = a.code === 'finalist';
      const p = trophies.progress[a.code];
      const earnedAt = isFinalist ? finals[finals.length - 1]?.at ?? null : p?.earnedAt ?? null;
      const progress = isFinalist ? (finals.length > 0 ? 1 : 0) : p?.progress ?? 0;
      return { a, isFinalist, earnedAt, progress, fraction: Math.min(1, progress / a.target) };
    })
    .sort((x, y) => {
      if (x.earnedAt && y.earnedAt) return x.earnedAt < y.earnedAt ? 1 : -1;
      if (x.earnedAt || y.earnedAt) return x.earnedAt ? -1 : 1;
      return y.fraction - x.fraction || x.a.sort - y.a.sort;
    });
  const earnedItems = items.filter((i) => i.earnedAt).length;
  const visible = expanded ? items : items.slice(0, earnedItems + 3);
  const hidden = items.length - visible.length;

  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={styles.section}>Titles and trophies</Text>
        <Text style={styles.count}>
          {earnedCount} earned
        </Text>
      </View>
      {isMe && (
        <Text style={styles.hint}>
          {shown
            ? `Under your name: ${badge?.titleLabel}. Tap ✓ Showing to remove it.`
            : earnedCount > 0
              ? 'Pick one of your titles to show under your name.'
              : 'Earn titles by playing: they show up here.'}
        </Text>
      )}

      {/* Tournament honours first: the rarest. */}
      {wins.map((h) => (
        <View key={`c-${h.tournamentId}`} style={[styles.row, styles.rowEarned, styles.rowGold]}>
          <Text style={styles.emoji}>🏆</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>Champion · {h.tournamentName}</Text>
            <Text style={styles.desc}>Won the tournament · {monthYear(h.at)} · gold laurel</Text>
          </View>
          {showButton(`champion:${h.tournamentId}`)}
        </View>
      ))}

      {visible.map(({ a, earnedAt, progress, fraction, isFinalist }) => {
          return (
            <View key={a.code} style={[styles.row, earnedAt ? styles.rowEarned : styles.rowLocked]}>
              <Text style={[styles.emoji, !earnedAt && styles.emojiLocked]}>{a.emoji}</Text>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.name}>{a.name}</Text>
                <Text style={styles.desc}>
                  {a.description}
                  {isFinalist && finals.length > 1 ? ` · ${finals.length} finals` : ''}
                </Text>
                {earnedAt ? (
                  <Text style={styles.earned}>Earned {shortDate(earnedAt)}</Text>
                ) : a.target > 1 ? (
                  <View style={styles.progressRow}>
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%` }]} />
                    </View>
                    <Text style={styles.progressText}>
                      {progress}/{a.target}
                    </Text>
                  </View>
                ) : null}
              </View>
              {earnedAt && showButton(a.code)}
            </View>
          );
        })}
      {hidden > 0 || expanded ? (
        <Pressable onPress={() => setExpanded((e) => !e)} accessibilityRole="button">
          <Text style={styles.more}>{expanded ? 'Show less' : `See all ${items.length} (${hidden} more)`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    section: { color: colors.textMuted, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 },
    count: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
    hint: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.sm + 4,
      marginBottom: spacing.sm,
    },
    rowEarned: {},
    rowLocked: { opacity: 0.75 },
    rowGold: { borderColor: '#C28D10', borderWidth: 1.5 },
    emoji: { fontSize: 26, width: 36, textAlign: 'center' },
    emojiLocked: { opacity: 0.35 },
    name: { color: colors.text, fontSize: 15, fontWeight: '700' },
    desc: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
    earned: { color: colors.success, fontSize: 12, fontWeight: '600' },
    progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
    fill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
    progressText: { color: colors.textMuted, fontSize: 12, fontVariant: ['tabular-nums'], minWidth: 44, textAlign: 'right' },
    pill: {
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.primary,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 6,
      minWidth: 72,
      alignItems: 'center',
    },
    pillOn: { backgroundColor: colors.primary },
    pillText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
    pillTextOn: { color: colors.primaryText },
    more: { color: colors.primary, fontSize: 14, fontWeight: '600', textAlign: 'center', paddingVertical: spacing.sm },
  });
}
