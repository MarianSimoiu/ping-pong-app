import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useBadge, useBadges } from '@/context/BadgesContext';
import { fetchTrophies, setTitle, type Honour, type Trophies } from '@/lib/achievements';
import { showAlert } from '@/lib/platformAlert';
import { radius, spacing, useTheme, type Colors } from '@/theme';

const monthYear = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

type Tab = 'titles' | 'trophies';

// A player's titles and trophies, in two tabs. Titles: every achievement with
// their progress, and (on their own profile) which earned title to show under
// their name. Trophies: their tournament finals, won and lost, and the crown
// while they lead the season points.
export function TrophyCabinet({ playerId, isMe }: { playerId: string; isMe: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const badge = useBadge(playerId);
  const [trophies, setTrophies] = useState<Trophies | null>(null);
  const [tab, setTab] = useState<Tab>('titles');

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

  if (!trophies) return <ActivityIndicator color={colors.textMuted} style={{ marginVertical: spacing.md }} />;

  const leader = badge?.seasonLeader ?? false;
  return (
    <View>
      <Text style={styles.section}>Titles and trophies</Text>
      <View style={styles.tabs} accessibilityRole="tablist">
        <TabButton label="Titles" count={trophies.titles.length} active={tab === 'titles'} onPress={() => setTab('titles')} />
        <TabButton
          label="Trophies"
          count={trophies.honours.length + (leader ? 1 : 0)}
          active={tab === 'trophies'}
          onPress={() => setTab('trophies')}
        />
      </View>
      {tab === 'titles' ? (
        <TitlesTab playerId={playerId} isMe={isMe} trophies={trophies} />
      ) : (
        <TrophiesTab isMe={isMe} honours={trophies.honours} leader={leader} />
      )}
    </View>
  );
}

function TabButton({ label, count, active, onPress }: { label: string; count: number; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      style={[styles.tab, active && styles.tabActive]}
      onPress={onPress}
      accessibilityRole="tab"
      aria-selected={active}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
      <View style={[styles.tabCount, active && styles.tabCountActive]}>
        <Text style={[styles.tabCountText, active && styles.tabTextActive]}>{count}</Text>
      </View>
    </Pressable>
  );
}

// Every title: the ones they can show (tournaments won first, the rarest),
// then the rest with their progress. Collapsed to the earned ones plus the 3
// closest until "See all".
function TitlesTab({ playerId, isMe, trophies }: { playerId: string; isMe: boolean; trophies: Trophies }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const badge = useBadge(playerId);
  const { refresh } = useBadges();
  const [saving, setSaving] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

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

  // A champion's titles are listed per tournament above; until then
  // "Champion" waits in the list like any other title.
  const items = trophies.catalog
    .filter((a) => a.code !== 'champion' || wins.length === 0)
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
      {isMe && (
        <Text style={styles.hint}>
          {shown
            ? `Under your name: ${badge?.titleLabel}. Tap ✓ Showing to remove it.`
            : earnedCount > 0
              ? 'Pick one of your titles to show under your name.'
              : 'Earn titles by playing: they show up here.'}
        </Text>
      )}

      {wins.map((h) => (
        <View key={`c-${h.tournamentId}`} style={[styles.row, styles.rowGold]}>
          <Text style={styles.emoji}>🏆</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>Champion · {h.tournamentName}</Text>
            <Text style={styles.desc}>Won the tournament · {monthYear(h.at)} · gold laurel</Text>
          </View>
          {showButton(`champion:${h.tournamentId}`)}
        </View>
      ))}

      {visible.map(({ a, earnedAt, progress, fraction, isFinalist }) => (
        <View key={a.code} style={[styles.row, !earnedAt && styles.rowLocked]}>
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
      ))}
      {hidden > 0 || expanded ? (
        <Pressable onPress={() => setExpanded((e) => !e)} accessibilityRole="button">
          <Text style={styles.more}>{expanded ? 'Show less' : `See all ${items.length} (${hidden} more)`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// The trophy shelf: the crown while they lead the season, then every final
// they played, newest first — 🏆 won, 🥈 runner-up.
function TrophiesTab({ isMe, honours, leader }: { isMe: boolean; honours: Honour[]; leader: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (honours.length === 0 && !leader) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyEmoji}>🏆</Text>
        <Text style={styles.emptyTitle}>No trophies yet</Text>
        <Text style={styles.emptyText}>
          Win a tournament for a trophy and a gold laurel around {isMe ? 'your' : 'their'} avatar. Reach a final for a
          runner-up medal. Lead the season points for the 👑.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.grid}>
      {leader && (
        <View style={styles.cell}>
          <View style={[styles.tile, styles.tileLeader]} accessibilityLabel="Season leader: most season points right now">
            <Text style={styles.tileEmoji}>👑</Text>
            <Text style={styles.tileName}>Season leader</Text>
            <Text style={styles.tileResult}>Most season points</Text>
            <Text style={styles.tileDate}>Right now</Text>
          </View>
        </View>
      )}
      {honours.map((h) => (
        <View key={h.tournamentId} style={styles.cell}>
          <View
            style={[styles.tile, h.won && styles.tileGold]}
            accessibilityLabel={`${h.tournamentName}: ${h.won ? 'champion' : 'runner-up'}, ${monthYear(h.at)}`}
          >
            <Text style={styles.tileEmoji}>{h.won ? '🏆' : '🥈'}</Text>
            <Text style={styles.tileName} numberOfLines={2}>
              {h.tournamentName}
            </Text>
            <Text style={styles.tileResult}>{h.won ? 'Champion' : 'Runner-up'}</Text>
            <Text style={styles.tileDate}>{monthYear(h.at)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const GOLD = '#C28D10';

function createStyles(colors: Colors) {
  return StyleSheet.create({
    section: {
      color: colors.textMuted,
      fontSize: 13,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
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
    tabCountActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
    tabCountText: { color: colors.textMuted, fontSize: 12, fontWeight: '700', lineHeight: 18 },
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
    rowLocked: { opacity: 0.75 },
    rowGold: { borderColor: GOLD, borderWidth: 1.5 },
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
    // Two trophies a row; the cells' padding makes the gutters.
    grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: spacing.xs },
    cell: { width: '50%', padding: 4 },
    tile: {
      flex: 1,
      alignItems: 'center',
      gap: 2,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.sm,
    },
    tileGold: { borderColor: GOLD, borderWidth: 1.5, backgroundColor: 'rgba(255, 196, 0, 0.08)' },
    tileLeader: { borderColor: colors.primary, borderWidth: 1.5 },
    tileEmoji: { fontSize: 36, marginBottom: spacing.xs },
    tileName: { color: colors.text, fontSize: 14, fontWeight: '700', textAlign: 'center' },
    tileResult: { color: colors.text, fontSize: 12, fontWeight: '600' },
    tileDate: { color: colors.textMuted, fontSize: 11 },
    empty: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      marginBottom: spacing.sm,
      gap: spacing.xs,
    },
    emptyEmoji: { fontSize: 36, opacity: 0.35 },
    emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
    emptyText: { color: colors.textMuted, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  });
}
