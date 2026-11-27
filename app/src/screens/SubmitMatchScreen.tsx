import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MatchScoreForm } from '@/components/MatchScoreForm';
import { PlayerChips } from '@/components/PlayerChips';
import { useAuth } from '@/context/AuthContext';
import {
  boostLabel,
  CHALLENGE_FORMATS,
  challengeWith,
  fetchChallengeState,
  type ChallengeState,
} from '@/lib/challenges';
import { fetchOpponents, submitMatch, type RawGameInput } from '@/lib/matches';
import { showAlert } from '@/lib/platformAlert';
import { fetchMyProfile } from '@/lib/players';
import type { OpponentOption } from '@/lib/types';
import type { HomeStackScreenProps } from '@/navigation/types';
import { radius, spacing, useTheme, type Colors } from '@/theme';

// Recording a singles match. Against someone you have a weekly challenge with
// (yours or theirs, lib/challenges.ts), it asks whether this is the challenge
// match: best of 3 or best of 5, as you two agreed, or a normal match.
export function SubmitMatchScreen({ navigation, route }: HomeStackScreenProps<'SubmitMatch'>) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { session } = useAuth();
  const [opponents, setOpponents] = useState<OpponentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [opponentId, setOpponentId] = useState<string | null>(route.params?.opponentId ?? null);
  const [challenges, setChallenges] = useState<ChallengeState | null>(null);
  // The challenge match's format; null: a normal match.
  const [format, setFormat] = useState<number | null>(CHALLENGE_FORMATS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const [players, me] = await Promise.all([fetchOpponents(session.user.id), fetchMyProfile(session.user.id)]);
      setOpponents(players);
      if (me) fetchChallengeState(me.id).then(setChallenges, () => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load players');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  // A new opponent starts from the usual challenge format.
  useEffect(() => setFormat(CHALLENGE_FORMATS[0]), [opponentId]);

  const opponentName = opponents.find((o) => o.id === opponentId)?.display_name ?? 'Opponent';
  const challenge = opponentId && challenges ? challengeWith(challenges, opponentId) : null;
  const bestOf = challenge ? format : null;

  async function onSubmit(games: RawGameInput[]) {
    if (!opponentId) return;
    setError(null);
    setSubmitting(true);
    try {
      await submitMatch({ opponentId, games, challenge: bestOf ? { bestOf } : null });
      if (bestOf) {
        showAlert(
          'Challenge match submitted',
          `${opponentName} needs to confirm it. Ratings change then${challenge?.yours ? ', with your challenge bonus if you won' : ''}.`,
        );
      } else {
        showAlert(
          'Match submitted',
          'Your opponent needs to confirm it before ratings update. They’ll see it under “Awaiting your confirmation”.',
        );
      }
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

  const needed = bestOf ? Math.floor(bestOf / 2) + 1 : 0;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>1. Opponent</Text>
        {opponents.length === 0 ? (
          <Text style={styles.empty}>
            No other players yet. Ask a friend to sign up, then record your match.
          </Text>
        ) : (
          <PlayerChips
            players={opponents}
            selectedIds={opponentId ? [opponentId] : []}
            onPress={setOpponentId}
          />
        )}

        {opponentId && challenge && (
          <>
            <Text style={styles.label}>2. Challenge match</Text>
            <View style={styles.challengeBox}>
              <Text style={styles.challengeText}>{challengeLine(challenge, opponentName)}</Text>
              <View style={styles.chips}>
                {CHALLENGE_FORMATS.map((n) => (
                  <Chip key={n} label={`Best of ${n}`} active={format === n} onPress={() => setFormat(n)} styles={styles} />
                ))}
                <Chip label="Normal match" active={format === null} onPress={() => setFormat(null)} styles={styles} />
              </View>
            </View>
          </>
        )}

        {opponentId ? (
          <MatchScoreForm
            firstStep={challenge ? 3 : 2}
            sideA="You"
            sideB={opponentName}
            winnerA="You won"
            bestOf={bestOf}
            hint={
              bestOf
                ? `Best of ${bestOf}: the first to win ${needed} games takes the match.`
                : 'How many games did each of you win? Any score works — 1–0, 2–1, 3–2, whatever happened.'
            }
            submitting={submitting}
            submitError={error}
            onSubmit={onSubmit}
          />
        ) : (
          error && <Text style={styles.error}>{error}</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// Whose challenge it is, and what a win does.
function challengeLine(c: { yours: boolean; theirs: boolean; boost: number | null }, name: string): string {
  const win = c.boost === null ? '' : c.boost >= 2 ? ' Win it to double the rating you gain.' : ` Win it for ${boostLabel(c.boost)} on the rating you gain.`;
  if (c.yours && c.theirs) return `⚡ Your challenge with ${name}, and theirs with you.${win}`;
  if (c.yours) return `⚡ Your challenge with ${name} this week.${win}`;
  return `⚡ ${name} picked you for a challenge this week. A win boosts their rating gain; yours counts as usual.`;
}

function Chip({
  label,
  active,
  onPress,
  styles,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      aria-checked={active}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
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
    error: { color: colors.danger, marginTop: spacing.md, fontSize: 14 },
    challengeBox: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.primary,
      padding: spacing.md,
      gap: spacing.sm,
    },
    challengeText: { color: colors.text, fontSize: 14, lineHeight: 20 },
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
  });
}
