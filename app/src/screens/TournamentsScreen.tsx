import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/context/AuthContext';
import { fetchIsAdmin } from '@/lib/players';
import { fetchTournaments, type TournamentSummary } from '@/lib/tournaments';
import type { TournamentsStackScreenProps } from '@/navigation/types';
import { radius, spacing, useTheme, type Colors } from '@/theme';

const STATUS_LABEL: Record<TournamentSummary['status'], string> = {
  draft: 'Draft',
  active: 'In progress',
  completed: 'Completed',
};

export function TournamentsScreen({ navigation }: TournamentsStackScreenProps<'TournamentsList'>) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { session } = useAuth();
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [list, admin] = await Promise.all([
        fetchTournaments(),
        // Only decides whether "+ New" shows, so a failure just hides it.
        session ? fetchIsAdmin(session.user.id).catch(() => false) : false,
      ]);
      setTournaments(list);
      setIsAdmin(admin);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tournaments');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

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
          <Text style={styles.emoji}>🎽</Text>
          <Text style={styles.placeholder}>
            {isAdmin
              ? 'No tournaments yet. Create one to bracket up your players — results feed the same rating engine as casual matches.'
              : 'No tournaments yet. They show up here once an admin creates one.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={tournaments}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
          renderItem={({ item }) => {
            const status = statusStyle(item.status, colors);
            return (
              <Pressable
                style={styles.row}
                onPress={() =>
                  navigation.navigate('TournamentDetail', { tournamentId: item.id, name: item.name })
                }
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {item.size}-player · best of {item.bestOf}
                  </Text>
                </View>
                <View style={[styles.badge, { backgroundColor: status.backgroundColor }]}>
                  <Text style={[styles.badgeText, { color: status.color }]}>
                    {STATUS_LABEL[item.status]}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

function statusStyle(status: TournamentSummary['status'], colors: Colors) {
  // "active" sits on the saturated primary color, so it needs light text;
  // the other two sit on pale backgrounds, where the normal dark text holds.
  if (status === 'completed') return { backgroundColor: colors.surfaceAlt, color: colors.text };
  if (status === 'active') return { backgroundColor: colors.primary, color: colors.primaryText };
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
    },
    rowName: { color: colors.text, fontSize: 16, fontWeight: '600' },
    rowMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    badge: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4 },
    badgeText: { color: colors.text, fontSize: 12, fontWeight: '600' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    emoji: { fontSize: 44, marginBottom: spacing.md },
    placeholder: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
    error: { color: colors.danger, padding: spacing.lg },
  });
}
