import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/context/AuthContext';
import { shortTimeLeft, useNow } from '@/lib/countdown';
import { fetchIsAdmin } from '@/lib/players';
import {
  fetchTournaments,
  isPastKickoff,
  MIN_TOURNAMENT_PLAYERS,
  requestKickoff,
  type TournamentListItem,
  type TournamentStatus,
} from '@/lib/tournaments';
import type { TournamentsStackScreenProps } from '@/navigation/types';
import { radius, spacing, useTheme, type Colors } from '@/theme';

const STATUS_LABEL: Record<TournamentStatus, string> = {
  draft: 'Draft',
  registration: 'Registration open',
  active: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// Open ones first (soonest kickoff first), then those being played, then the rest, newest first.
const ORDER: Record<TournamentStatus, number> = { registration: 0, active: 1, draft: 2, completed: 2, cancelled: 2 };
function byInterest(a: TournamentListItem, b: TournamentListItem): number {
  if (ORDER[a.status] !== ORDER[b.status]) return ORDER[a.status] - ORDER[b.status];
  if (a.status === 'registration' && a.kickoffAt && b.kickoffAt) return a.kickoffAt < b.kickoffAt ? -1 : 1;
  return a.createdAt < b.createdAt ? 1 : -1;
}

export function TournamentsScreen({ navigation }: TournamentsStackScreenProps<'TournamentsList'>) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { session } = useAuth();
  const [tournaments, setTournaments] = useState<TournamentListItem[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const userId = session?.user.id ?? null;

  const load = useCallback(async () => {
    try {
      setError(null);
      const [list, admin] = await Promise.all([
        fetchTournaments(userId),
        // Only decides whether "+ New" shows, so a failure just hides it.
        userId ? fetchIsAdmin(userId).catch(() => false) : false,
      ]);
      setTournaments([...list].sort(byInterest));
      setIsAdmin(admin);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tournaments');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Tick only while a countdown is on screen.
  const counting = tournaments.some((t) => t.status === 'registration');
  const now = useNow(counting ? 1000 : null);

  // A tournament whose kickoff has come with enough players: ask the server to
  // make the draw now (it would within a minute anyway), then show it.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    const due = tournaments.filter(
      (t) => isPastKickoff(t, now) && (t.registeredCount ?? 0) >= MIN_TOURNAMENT_PLAYERS && !asked.current.has(t.id),
    );
    if (due.length === 0) return;
    for (const t of due) asked.current.add(t.id);
    requestKickoff()
      .catch(() => {})
      .then(load);
  }, [tournaments, now, load]);

  function meta(t: TournamentListItem): string {
    if (t.status === 'registration' && t.kickoffAt) {
      const count = `${t.registeredCount ?? 0} registered`;
      if (!isPastKickoff(t, now)) return `Kickoff in ${shortTimeLeft(t.kickoffAt, now)} · ${count}`;
      return (t.registeredCount ?? 0) >= MIN_TOURNAMENT_PLAYERS
        ? `Making the draw… · ${count}`
        : `Waiting for the organizer · ${count}`;
    }
    if (t.status === 'cancelled') return `Best of ${t.bestOf}`;
    const players = t.registeredCount !== null ? `${t.registeredCount} players` : `${t.size}-player`;
    return `${players} · best of ${t.bestOf}`;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Tournaments</Text>
        {isAdmin && (
          <Pressable style={styles.newButton} onPress={() => navigation.navigate('CreateTournament')}>
            <Text style={styles.newButtonText}>+ New</Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xl }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : tournaments.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emoji}>🏆</Text>
          <Text style={styles.placeholder}>
            {isAdmin
              ? 'No tournaments yet. Create one and players on the leaderboard can register until kickoff.'
              : 'No tournaments yet. When one opens, you can register for it here.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={tournaments}
          keyExtractor={(t) => t.id}
          extraData={now}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
          renderItem={({ item }) => {
            const status = statusStyle(item.status, colors);
            return (
              <Pressable
                style={[styles.row, item.status === 'cancelled' && styles.rowMuted]}
                onPress={() => navigation.navigate('TournamentDetail', { tournamentId: item.id, name: item.name })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {meta(item)}
                  </Text>
                </View>
                <View style={styles.badges}>
                  <View style={[styles.badge, { backgroundColor: status.backgroundColor }]}>
                    <Text style={[styles.badgeText, { color: status.color }]}>{STATUS_LABEL[item.status]}</Text>
                  </View>
                  {item.imIn && (
                    <Text style={styles.youreIn}>{item.status === 'registration' ? '✓ Registered' : "✓ You're in"}</Text>
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

function statusStyle(status: TournamentStatus, colors: Colors) {
  // The saturated badges (open, in progress) take light text; the pale ones the normal text.
  if (status === 'registration') return { backgroundColor: colors.success, color: colors.primaryText };
  if (status === 'active') return { backgroundColor: colors.primary, color: colors.primaryText };
  if (status === 'completed') return { backgroundColor: colors.surfaceAlt, color: colors.text };
  return { backgroundColor: colors.border, color: colors.text };
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
    },
    title: { fontSize: 24, fontWeight: '700', color: colors.text },
    newButton: {
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    newButtonText: { color: colors.primaryText, fontWeight: '600' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      gap: spacing.sm,
    },
    rowMuted: { opacity: 0.7 },
    rowName: { color: colors.text, fontSize: 16, fontWeight: '600' },
    rowMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    badges: { alignItems: 'flex-end', gap: 4 },
    badge: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4 },
    badgeText: { color: colors.text, fontSize: 12, fontWeight: '600' },
    youreIn: { color: colors.success, fontSize: 12, fontWeight: '600' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    emoji: { fontSize: 44, marginBottom: spacing.md },
    placeholder: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
    error: { color: colors.danger, padding: spacing.lg },
  });
}
