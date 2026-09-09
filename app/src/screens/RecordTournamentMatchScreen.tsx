import React, { useState } from 'react';
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

import type { RawGameInput } from '@/lib/matches';
import { recordTournamentMatch } from '@/lib/tournaments';
import type { TournamentsStackScreenProps } from '@/navigation/types';
import { colors, radius, spacing } from '@/theme';

type GameRow = { a: string; b: string };

export function RecordTournamentMatchScreen({
  route,
  navigation,
}: TournamentsStackScreenProps<'RecordTournamentMatch'>) {
  const { tournamentMatchId, playerAName, playerBName, bestOf } = route.params;
  const [rows, setRows] = useState<GameRow[]>([{ a: '', b: '' }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setRow(i: number, key: 'a' | 'b', value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  }

  function addGame() {
    if (rows.length < bestOf) setRows((prev) => [...prev, { a: '', b: '' }]);
  }

  async function onSubmit() {
    setError(null);
    const games: RawGameInput[] = [];
    for (const r of rows) {
      if (r.a === '' && r.b === '') continue;
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
      await recordTournamentMatch({ tournamentMatchId, games });
      navigation.goBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to record match');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.matchup}>
          <Text style={styles.side} numberOfLines={1}>
            {playerAName}
          </Text>
          <Text style={styles.vs}>vs</Text>
          <Text style={styles.side} numberOfLines={1}>
            {playerBName}
          </Text>
        </View>
        <Text style={styles.hint}>Best of {bestOf} · scores as {playerAName} · {playerBName}</Text>

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
            <Text style={styles.buttonText}>Record result</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  matchup: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
  side: { color: colors.text, fontSize: 18, fontWeight: '700', flex: 1, textAlign: 'center' },
  vs: { color: colors.textMuted, marginHorizontal: spacing.sm },
  hint: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.lg },
  gameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
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
  addGame: { color: colors.primary, fontSize: 14, marginTop: spacing.xs, textAlign: 'center' },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
  error: { color: colors.danger, marginTop: spacing.md, fontSize: 14, textAlign: 'center' },
});
