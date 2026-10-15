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

// Matches the MAX_GAMES_PER_MATCH sanity cap enforced server-side in
// supabase/functions/_shared/match.ts — there's no preset format to pick
// from, just a ceiling so a runaway series can't grow forever.
const MAX_GAMES = 21;

type GameRow = { a: string; b: string };

// A plausible (winner, loser) score for one valid 11-point, win-by-2 game —
// mostly a clean 11-something finish, sometimes a deuce battle.
function randomGameScore(): [number, number] {
  if (Math.random() < 0.75) return [11, Math.floor(Math.random() * 10)]; // 11–0 .. 11–9
  const loser = 10 + Math.floor(Math.random() * 4); // deuce: 10–13, win by 2
  return [loser + 2, loser];
}

export function SubmitMatchScreen({ navigation }: HomeStackScreenProps<'SubmitMatch'>) {
  const { session } = useAuth();
  const [opponents, setOpponents] = useState<OpponentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [opponentId, setOpponentId] = useState<string | null>(null);
  const [rows, setRows] = useState<GameRow[]>([{ a: '', b: '' }]);
  const [mySets, setMySets] = useState('');
  const [oppSets, setOppSets] = useState('');
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
    if (rows.length < MAX_GAMES) setRows((prev) => [...prev, { a: '', b: '' }]);
  }

  // Fills the game rows from just a set score (e.g. "2 – 1"), for when you
  // remember who won how many games but not the exact points. Re-pressing
  // rerolls new scores for the same set score, without changing who won
  // which games overall.
  function randomizeFromSetScore() {
    setError(null);
    const mine = Number(mySets);
    const theirs = Number(oppSets);
    if (!Number.isInteger(mine) || !Number.isInteger(theirs) || mine < 0 || theirs < 0) {
      setError('Enter whole numbers for the set score');
      return;
    }
    const total = mine + theirs;
    if (total === 0) {
      setError('Enter a set score first, e.g. 2 – 1');
      return;
    }
    if (mine === theirs) {
      setError('The set score can’t be tied — someone has to win the match');
      return;
    }
    if (total > MAX_GAMES) {
      setError(`That’s ${total} games — the most a match can have is ${MAX_GAMES}`);
      return;
    }

    const outcomes: ('me' | 'opp')[] = [...Array(mine).fill('me'), ...Array(theirs).fill('opp')];
    for (let i = outcomes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [outcomes[i], outcomes[j]] = [outcomes[j], outcomes[i]];
    }

    setRows(
      outcomes.map((who) => {
        const [winner, loser] = randomGameScore();
        return who === 'me' ? { a: String(winner), b: String(loser) } : { a: String(loser), b: String(winner) };
      }),
    );
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
      await submitMatch({ opponentId, games });
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

        <Text style={styles.label}>Know the set score, not the exact points?</Text>
        <View style={styles.setScoreRow}>
          <TextInput
            style={styles.scoreInput}
            keyboardType="number-pad"
            placeholder="2"
            placeholderTextColor={colors.textMuted}
            value={mySets}
            onChangeText={setMySets}
          />
          <Text style={styles.dash}>–</Text>
          <TextInput
            style={styles.scoreInput}
            keyboardType="number-pad"
            placeholder="1"
            placeholderTextColor={colors.textMuted}
            value={oppSets}
            onChangeText={setOppSets}
          />
          <Pressable style={styles.randomizeButton} onPress={randomizeFromSetScore}>
            <Text style={styles.randomizeButtonText}>🎲 Randomize scores</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>Game scores (you · opponent)</Text>
        <Text style={styles.hint}>
          Add every game you played — win by more games than your opponent to win the match.
        </Text>
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

        {rows.length < MAX_GAMES && (
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
  hint: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.sm },
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
  setScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  randomizeButton: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  randomizeButtonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
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
