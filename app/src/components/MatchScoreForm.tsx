import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { RawGameInput } from '@/lib/matches';
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

// The score part of recording a match, shared by singles and doubles: the
// overall score (games won by each side), then each game's points, then
// Submit. Side A is always the person recording (and their partner), so
// `onSubmit` gets games with score_a = side A.
export function MatchScoreForm({
  firstStep,
  sideA,
  sideB,
  winnerA,
  hint,
  submitting,
  submitError,
  onSubmit,
}: {
  firstStep: number;
  sideA: string; // column heading, e.g. "You" or "You & Ben"
  sideB: string; // e.g. "Ana" or "Cris & Dana"
  winnerA: string; // shown when side A wins, e.g. "You won"
  hint: string;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (games: RawGameInput[]) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [mySets, setMySets] = useState('');
  const [oppSets, setOppSets] = useState('');
  const [rows, setRows] = useState<GameRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const setScoreError = describeSetScoreError(mySets, oppSets);
  const mine = Number(mySets);
  const theirs = Number(oppSets);
  const setScoreReady = mySets !== '' && oppSets !== '' && setScoreError === null;

  // The overall score decides how many games the next step asks for.
  // Changing it (to a different, still-valid total) starts that step over.
  useEffect(() => {
    setRows(setScoreReady ? Array.from({ length: mine + theirs }, () => ({ a: '', b: '' })) : []);
  }, [setScoreReady, mine, theirs]);

  function setRow(i: number, key: 'a' | 'b', value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  }

  // Fills every game row to match the overall score, in a close, believable
  // way (never a blowout). Re-pressing rerolls new numbers without changing
  // the overall score.
  function randomizeGames() {
    const outcomes: ('a' | 'b')[] = [...Array(mine).fill('a'), ...Array(theirs).fill('b')];
    for (let i = outcomes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [outcomes[i], outcomes[j]] = [outcomes[j], outcomes[i]];
    }
    setRows(
      outcomes.map((who) => {
        const [winner, loser] = randomCloseGameScore();
        return who === 'a' ? { a: String(winner), b: String(loser) } : { a: String(loser), b: String(winner) };
      }),
    );
  }

  function submit() {
    setError(null);
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
    onSubmit(games);
  }

  const shownError = error ?? submitError;

  return (
    <>
      <Text style={styles.label}>{firstStep}. Overall score</Text>
      <Text style={styles.hint}>{hint}</Text>
      <ScoreOwners sideA={sideA} sideB={sideB} styles={styles} />
      <View style={styles.scoreRow}>
        <View style={styles.scoreCell}>
          <TextInput
            style={styles.scoreInput}
            keyboardType="number-pad"
            placeholder="2"
            placeholderTextColor={colors.textMuted}
            value={mySets}
            onChangeText={setMySets}
            accessibilityLabel={`${sideA}: games won`}
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
            accessibilityLabel={`${sideB}: games won`}
          />
        </View>
      </View>
      {setScoreError ? (
        <Text style={styles.error}>{setScoreError}</Text>
      ) : (
        setScoreReady && (
          <Text style={[styles.summary, mine > theirs ? styles.summaryWin : styles.summaryLoss]}>
            {mine > theirs ? `${winnerA} ${mine}–${theirs}` : `${sideB} won ${theirs}–${mine}`}
          </Text>
        )
      )}

      {setScoreReady && (
        <>
          <Text style={styles.label}>{firstStep + 1}. Game scores</Text>
          <View style={styles.gameScoresHeader}>
            <Text style={styles.hint}>Enter the exact points for each game.</Text>
            <Pressable style={styles.randomizeButton} onPress={randomizeGames}>
              <Text style={styles.randomizeButtonText}>🎲 Randomize</Text>
            </Pressable>
          </View>
          <ScoreOwners sideA={sideA} sideB={sideB} styles={styles} numbered />
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
                  accessibilityLabel={`Game ${i + 1}, ${sideA}: points`}
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
                  accessibilityLabel={`Game ${i + 1}, ${sideB}: points`}
                />
              </View>
            </View>
          ))}
        </>
      )}

      {shownError && <Text style={styles.error}>{shownError}</Text>}

      {setScoreReady && (
        <Pressable
          style={[styles.button, submitting && { opacity: 0.6 }]}
          onPress={submit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color={colors.primaryText} />
          ) : (
            <Text style={styles.buttonText}>Submit match</Text>
          )}
        </Pressable>
      )}
    </>
  );
}

// The two sides' names over the score columns, so it's clear whose number
// goes in which box. `numbered` leaves room for the game-number column of
// the game rows.
function ScoreOwners({
  sideA,
  sideB,
  numbered,
  styles,
}: {
  sideA: string;
  sideB: string;
  numbered?: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.ownersRow}>
      {numbered && <View style={styles.gameNoSpacer} />}
      <Text style={[styles.scoreCell, styles.owner]} numberOfLines={1}>
        {sideA}
      </Text>
      <View style={styles.dashBox} />
      <Text style={[styles.scoreCell, styles.owner]} numberOfLines={1}>
        {sideB}
      </Text>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    label: {
      color: colors.textMuted,
      fontSize: 13,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    hint: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.sm },
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
