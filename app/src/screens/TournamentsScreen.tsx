import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchTournaments, type TournamentSummary } from '@/lib/tournaments';
import type { TournamentsStackScreenProps } from '@/navigation/types';
import { colors, radius, spacing } from '@/theme';

const STATUS_LABEL: Record<TournamentSummary['status'], string> = {
  draft: 'Draft',
  active: 'In progress',
  completed: 'Completed',
};

export function TournamentsScreen({ navigation }: TournamentsStackScreenProps<'TournamentsList'>) {
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setTournaments(await fetchTournaments());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tournaments');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Tournaments</Text>
        <Pressable style={styles.newButton} onPress={() => navigation.navigate('CreateTournament')}>
          <Text style={styles.newButtonText}>+ New</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xl }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : tournaments.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emoji}>🎽</Text>
          <Text style={styles.placeholder}>
            No tournaments yet. Create one to bracket up your players — results feed
            the same rating engine as casual matches.
          </Text>
        </View>
      ) : (
        <FlatList
          data={tournaments}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
          renderItem={({ item }) => (
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
              <View style={[styles.badge, statusStyle(item.status)]}>
                <Text style={styles.badgeText}>{STATUS_LABEL[item.status]}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function statusStyle(status: TournamentSummary['status']) {
  if (status === 'completed') return { backgroundColor: colors.surfaceAlt };
  if (status === 'active') return { backgroundColor: colors.primary };
  return { backgroundColor: colors.border };
}

const styles = StyleSheet.create({
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
