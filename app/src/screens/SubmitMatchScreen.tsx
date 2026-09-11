import React, { useCallback, useEffect, useState } from 'react';
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

import { useAuth } from '@/context/AuthContext';
import { fetchOpponents, submitMatch, type RawGameInput } from '@/lib/matches';
import { showAlert } from '@/lib/platformAlert';
import type { OpponentOption } from '@/lib/types';
import type { HomeStackScreenProps } from '@/navigation/types';
import { colors, radius, spacing } from '@/theme';

const BEST_OF_OPTIONS = [3, 5] as const;

type GameRow = { a: string; b: string };

export function SubmitMatchScreen({ navigation }: HomeStackScreenProps<'SubmitMatch'>) {
  const { session } = useAuth();
  const [opponents, setOpponents] = useState<OpponentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [opponentId, setOpponentId] = useState<string | null>(null);
  const [bestOf, setBestOf] = useState<number>(3);
  const [rows, setRows] = useState<GameRow[]>([{ a: '', b: '' }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      setOpponents(await fetchOpponents(session.user.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load players');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  function setRow(i: number, key: 'a' | 'b', value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  }

  function addGame() {
    if (rows.length < bestOf) setRows((prev) => [...prev, { a: '', b: '' }]);
  }

  async function onSubmit() {
    setError(null);
    if (!opponentId) {
      setError('Pick an opponent first');
      return;
    }
    const games: RawGameInput[] = [];
    for (const r of rows) {
      if (r.a === '' && r.b === '') continue; // skip empty rows
      const a = Number(r.a);
      const b = Number(r.b);
      if (!Number.isInteger(a) || !Number.isInteger(b)) {
        setError('Scores must be whole numbers');
        return;
      }
      games.push({ score_a: a, score_b: b });
    }
    if (games.length === 0) {
      setError('Enter at least one game');
      return;
    }

    setSubmitting(true);
    try {
      await submitMatch({ opponentId, bestOf, games });
      showAlert(
        'Match submitted',
        'Your opponent needs to confirm it before ratings update. They’ll see it under “Awaiting your confirmation”.',
      );
      navigation.goBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit match');
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
        <Text style={styles.label}>Opponent</Text>
        {opponents.length === 0 ? (
          <Text style={styles.empty}>
            No other players yet. Ask a friend to sign up, then record your match.
          </Text>
        ) : (
          <View style={styles.chips}>
            {opponents.map((o) => (
              <Pressable
                key={o.id}
                style={[styles.chip, opponentId === o.id && styles.chipActive]}
                onPress={() => setOpponentId(o.id)}
              >
                <Text style={[styles.chipText, opponentId === o.id && styles.chipTextActive]}>
                  {o.display_name}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <Text style={styles.label}>Format</Text>
        <View style={styles.chips}>
          {BEST_OF_OPTIONS.map((n) => (
            <Pressable
              key={n}
              style={[styles.chip, bestOf === n && styles.chipActive]}
              onPress={() => setBestOf(n)}
            >
              <Text style={[styles.chipText, bestOf === n && styles.chipTextActive]}>
                Best of {n}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Game scores (you · opponent)</Text>
        {rows.map((r, i) => (
          <View key={i} style={styles.gameRow}>
            <Text style={styles.gameNo}>{i + 1}</Text>
            <TextInput
              style={styles.scoreInput}
              keyboardType="number-pad"
              placeholder="11"
              placeholderTextColor={colors.textMuted}
              value={r.a}
              onChangeText={(v) => setRow(i, 'a', v)}
            />
            <Text style={styles.dash}>–</Text>
            <TextInput
              style={styles.scoreInput}
              keyboardType="number-pad"
              placeholder="7"
              placeholderTextColor={colors.textMuted}
              value={r.b}
              onChangeText={(v) => setRow(i, 'b', v)}
            />
          </View>
        ))}

        {rows.length < bestOf && (
          <Pressable onPress={addGame}>
            <Text style={styles.addGame}>+ Add game</Text>
          </Pressable>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.button, submitting && { opacity: 0.6 }]}
          onPress={onSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color={colors.primaryText} />
          ) : (
            <Text style={styles.buttonText}>Submit match</Text>
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
  empty: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
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
  gameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  gameNo: { color: colors.textMuted, width: 24, fontSize: 14 },
  scoreInput: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: 18,
    textAlign: 'center',
    width: 72,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dash: { color: colors.textMuted, marginHorizontal: spacing.md, fontSize: 18 },
  addGame: { color: colors.primary, fontSize: 14, marginTop: spacing.xs },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
  error: { color: colors.danger, marginTop: spacing.md, fontSize: 14 },
});
