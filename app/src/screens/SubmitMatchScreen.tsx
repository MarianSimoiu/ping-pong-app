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

import { useAuth } from '@/context/AuthContext';
import { fetchOpponents, submitMatch, type RawGameInput } from '@/lib/matches';
import { showAlert } from '@/lib/platformAlert';
import type { OpponentOption } from '@/lib/types';
import type { HomeStackScreenProps } from '@/navigation/types';
import { radius, spacing, useTheme, type Colors } from '@/theme';

// Matches the MAX_GAMES_PER_MATCH sanity cap enforced server-side in
// supabase/functions/_shared/match.ts — there's no preset format to pick
// from, just a ceiling so a runaway series can't grow forever.
const MAX_GAMES = 21;

type GameRow = { a: string; b: string };

// A close, believable (winner, loser) score for one valid 11-point, win-by-2
// game — deliberately never a blowout (e.g. 11–2). The rating engine only
// ever sees the match's overall win/loss, never per-game margins, so this
// bias doesn't change anyone's rating — it's so a guessed-at score doesn't
// *look* like a one-sided result that didn't really happen.
function randomCloseGameScore(): [number, number] {
  if (Math.random() < 0.6) return [11, 7 + Math.floor(Math.random() * 3)]; // 11–7, 11–8, 11–9
  const loser = 10 + Math.floor(Math.random() * 4); // deuce: 10–13, win by 2
  return [loser + 2, loser];
}

// null = not answered yet (no error to show); a string = answered but invalid.
function describeSetScoreError(mySetsStr: string, oppSetsStr: string): string | null {
  if (mySetsStr === '' || oppSetsStr === '') return null;
  const mine = Number(mySetsStr);
  const theirs = Number(oppSetsStr);
  if (!Number.isInteger(mine) || !Number.isInteger(theirs) || mine < 0 || theirs < 0) {
    return 'Enter whole numbers for the score';
  }
  if (mine === theirs) return 'The score can’t be tied — someone has to win the match';
  const total = mine + theirs;
  if (total > MAX_GAMES) return `That’s ${total} games — the most a match can have is ${MAX_GAMES}`;
  return null;
}

export function SubmitMatchScreen({ navigation }: HomeStackScreenProps<'SubmitMatch'>) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { session } = useAuth();
  const [opponents, setOpponents] = useState<OpponentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [opponentId, setOpponentId] = useState<string | null>(null);
  const [mySets, setMySets] = useState('');
  const [oppSets, setOppSets] = useState('');
  const [rows, setRows] = useState<GameRow[]>([]);
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

  const opponentName = opponents.find((o) => o.id === opponentId)?.display_name ?? 'Opponent';
  const setScoreError = describeSetScoreError(mySets, oppSets);
  const mine = Number(mySets);
  const theirs = Number(oppSets);
  const setScoreReady = mySets !== '' && oppSets !== '' && setScoreError === null;

  // The overall score is step 2 — it decides how many games step 3 asks for.
  // Changing it (to a different, still-valid total) starts step 3 over.
  useEffect(() => {
    setRows(setScoreReady ? Array.from({ length: mine + theirs }, () => ({ a: '', b: '' })) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setScoreReady, mine, theirs]);

  function setRow(i: number, key: 'a' | 'b', value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  }

  // Fills every game row to match the step-2 score, in a close, believable
  // way (never a blowout). Re-pressing rerolls new numbers without changing
  // the overall score.
  function randomizeGames() {
    const outcomes: ('me' | 'opp')[] = [...Array(mine).fill('me'), ...Array(theirs).fill('opp')];
    for (let i = outcomes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [outcomes[i], outcomes[j]] = [outcomes[j], outcomes[i]];
    }
    setRows(
      outcomes.map((who) => {
        const [winner, loser] = randomCloseGameScore();
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
    if (!setScoreReady) {
      setError('Enter the overall score first');
      return;
    }
    const games: RawGameInput[] = [];
    let aWins = 0;
    let bWins = 0;
    for (const r of rows) {
      const a = Number(r.a);
      const b = Number(r.b);
      if (r.a === '' || r.b === '' || !Number.isInteger(a) || !Number.isInteger(b)) {
        setError('Fill in every game’s score, or tap Randomize');
        return;
      }
      if (a > b) aWins += 1;
      else bWins += 1;
      games.push({ score_a: a, score_b: b });
    }
    if (aWins !== mine || bWins !== theirs) {
      setError(
        `Those game scores add up to ${aWins}–${bWins}, not the ${mine}–${theirs} you entered above.`,
      );
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
        <Text style={styles.label}>1. Opponent</Text>
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

        {opponentId && (
          <>
            <Text style={styles.label}>2. Overall score</Text>
            <Text style={styles.hint}>
              How many games did each of you win? Any score works — 1–0, 2–1, 3–2, whatever happened.
            </Text>
            <ScoreOwners opponentName={opponentName} styles={styles} />
            <View style={styles.scoreRow}>
              <View style={styles.scoreCell}>
                <TextInput
                  style={styles.scoreInput}
                  keyboardType="number-pad"
                  placeholder="2"
                  placeholderTextColor={colors.textMuted}
                  value={mySets}
                  onChangeText={setMySets}
                  accessibilityLabel="Games you won"
                />
              </View>
              <View style={styles.dashBox}>
                <Text style={styles.dash}>–</Text>
              </View>
              <View style={styles.scoreCell}>
                <TextInput
                  style={styles.scoreInput}
                  keyboardType="number-pad"
                  placeholder="1"
                  placeholderTextColor={colors.textMuted}
                  value={oppSets}
                  onChangeText={setOppSets}
                  accessibilityLabel={`Games ${opponentName} won`}
                />
              </View>
            </View>
            {setScoreError ? (
              <Text style={styles.error}>{setScoreError}</Text>
            ) : (
              setScoreReady && (
                <Text style={[styles.summary, mine > theirs ? styles.summaryWin : styles.summaryLoss]}>
                  {mine > theirs ? `You won ${mine}–${theirs}` : `${opponentName} won ${theirs}–${mine}`}
                </Text>
              )
            )}
          </>
        )}

        {setScoreReady && (
          <>
            <Text style={styles.label}>3. Game scores</Text>
            <View style={styles.gameScoresHeader}>
              <Text style={styles.hint}>Enter the exact points for each game.</Text>
              <Pressable style={styles.randomizeButton} onPress={randomizeGames}>
                <Text style={styles.randomizeButtonText}>🎲 Randomize</Text>
              </Pressable>
            </View>
            <ScoreOwners opponentName={opponentName} styles={styles} numbered />
            {rows.map((r, i) => (
              <View key={i} style={styles.scoreRow}>
                <Text style={styles.gameNo}>{i + 1}</Text>
                <View style={styles.scoreCell}>
                  <TextInput
                    style={styles.scoreInput}
                    keyboardType="number-pad"
                    placeholder="11"
                    placeholderTextColor={colors.textMuted}
                    value={r.a}
                    onChangeText={(v) => setRow(i, 'a', v)}
                    accessibilityLabel={`Game ${i + 1}: your points`}
                  />
                </View>
                <View style={styles.dashBox}>
                  <Text style={styles.dash}>–</Text>
                </View>
                <View style={styles.scoreCell}>
                  <TextInput
                    style={styles.scoreInput}
                    keyboardType="number-pad"
                    placeholder="7"
                    placeholderTextColor={colors.textMuted}
                    value={r.b}
                    onChangeText={(v) => setRow(i, 'b', v)}
                    accessibilityLabel={`Game ${i + 1}: ${opponentName}'s points`}
                  />
                </View>
              </View>
            ))}
          </>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        {setScoreReady && (
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
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// "You" and the opponent's name over the two score columns, so it's clear
// whose number goes in which box. `numbered` leaves room for the game-number
// column of the game rows.
function ScoreOwners({
  opponentName,
  numbered,
  styles,
}: {
  opponentName: string;
  numbered?: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.ownersRow}>
      {numbered && <View style={styles.gameNoSpacer} />}
      <Text style={[styles.scoreCell, styles.owner]} numberOfLines={1}>
        You
      </Text>
      <View style={styles.dashBox} />
      <Text style={[styles.scoreCell, styles.owner]} numberOfLines={1}>
        {opponentName}
      </Text>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
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
    scoreRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
    ownersRow: { flexDirection: 'row', marginBottom: spacing.xs },
    // Wider than the input, so a longer name fits over its column.
    scoreCell: { width: 96, alignItems: 'center' },
    owner: { color: colors.text, fontSize: 13, fontWeight: '600', textAlign: 'center' },
    gameNo: { color: colors.textMuted, width: 24, fontSize: 14 },
    gameNoSpacer: { width: 24 },
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
    dashBox: { width: 24, alignItems: 'center' },
    dash: { color: colors.textMuted, fontSize: 18 },
    summary: { fontSize: 14, fontWeight: '600' },
    summaryWin: { color: colors.success },
    summaryLoss: { color: colors.danger },
    gameScoresHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
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
}
