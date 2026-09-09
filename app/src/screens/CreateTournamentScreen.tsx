import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createTournament, fetchSeedablePlayers, type PlayerWithRatingRow } from '@/lib/tournaments';
import type { TournamentsStackScreenProps } from '@/navigation/types';
import { colors, radius, spacing } from '@/theme';

const BEST_OF_OPTIONS = [3, 5] as const;

export function CreateTournamentScreen({ navigation }: TournamentsStackScreenProps<'CreateTournament'>) {
  const [players, setPlayers] = useState<PlayerWithRatingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [bestOf, setBestOf] = useState(3);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPlayers(await fetchSeedablePlayers());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load players');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Seed by rating (players is already sorted best-first); keep that order.
  const seededIds = useMemo(
    () => players.filter((p) => selected.has(p.id)).map((p) => p.id),
    [players, selected],
  );

  async function onCreate() {
    setError(null);
    if (!name.trim()) {
      setError('Give the tournament a name');
      return;
    }
    if (seededIds.length < 2) {
      setError('Select at least 2 participants');
      return;
    }
    setSubmitting(true);
    try {
      const { tournamentId } = await createTournament({
        name: name.trim(),
        tier: 1,
        bestOf,
        participantIds: seededIds,
      });
      // Replace so Back returns to the list, not the create form.
      navigation.replace('TournamentDetail', { tournamentId, name: name.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create tournament');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xl }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          placeholder="Friday night cup"
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={setName}
        />

        <Text style={styles.label}>Format</Text>
        <View style={styles.chips}>
          {BEST_OF_OPTIONS.map((n) => (
            <Pressable
              key={n}
              style={[styles.chip, bestOf === n && styles.chipActive]}
              onPress={() => setBestOf(n)}
            >
              <Text style={[styles.chipText, bestOf === n && styles.chipTextActive]}>Best of {n}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>
          Participants ({seededIds.length} selected) — seeded by rating
        </Text>
        {players.length === 0 ? (
          <Text style={styles.empty}>No players yet.</Text>
        ) : (
          players.map((p, i) => {
            const isSelected = selected.has(p.id);
            const seed = isSelected ? seededIds.indexOf(p.id) + 1 : null;
            return (
              <Pressable key={p.id} style={styles.playerRow} onPress={() => toggle(p.id)}>
                <View style={[styles.checkbox, isSelected && styles.checkboxOn]}>
                  {isSelected && <Text style={styles.check}>✓</Text>}
                </View>
                <Text style={styles.playerName} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={styles.playerRating}>{Math.round(p.rating)}</Text>
                {seed !== null && <Text style={styles.seed}>#{seed}</Text>}
              </Pressable>
            );
          })
        )}

        <Text style={styles.note}>
          The field is rounded up to a power of two; top seeds get byes. Results
          count toward Glicko-2 ratings just like casual matches.
        </Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.button, submitting && { opacity: 0.6 }]}
          onPress={onCreate}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color={colors.primaryText} />
          ) : (
            <Text style={styles.buttonText}>Create tournament</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  label: {
    color: colors.textMuted,
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
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
  chips: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextActive: { color: colors.primaryText, fontWeight: '600' },
  empty: { color: colors.textMuted, fontSize: 14 },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  check: { color: colors.primaryText, fontWeight: '700', fontSize: 14 },
  playerName: { color: colors.text, fontSize: 15, marginLeft: spacing.md, flex: 1 },
  playerRating: { color: colors.textMuted, fontSize: 14, marginRight: spacing.sm },
  seed: { color: colors.primary, fontSize: 13, fontWeight: '700', width: 32, textAlign: 'right' },
  note: { color: colors.textMuted, fontSize: 13, marginTop: spacing.lg, lineHeight: 19 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
  error: { color: colors.danger, marginTop: spacing.md, fontSize: 14 },
});
