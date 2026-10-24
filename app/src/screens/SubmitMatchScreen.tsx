import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MatchScoreForm } from '@/components/MatchScoreForm';
import { PlayerChips } from '@/components/PlayerChips';
import { useAuth } from '@/context/AuthContext';
import { fetchOpponents, submitMatch, type RawGameInput } from '@/lib/matches';
import { showAlert } from '@/lib/platformAlert';
import type { OpponentOption } from '@/lib/types';
import type { HomeStackScreenProps } from '@/navigation/types';
import { spacing, useTheme, type Colors } from '@/theme';

export function SubmitMatchScreen({ navigation }: HomeStackScreenProps<'SubmitMatch'>) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { session } = useAuth();
  const [opponents, setOpponents] = useState<OpponentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [opponentId, setOpponentId] = useState<string | null>(null);
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

  async function onSubmit(games: RawGameInput[]) {
    if (!opponentId) return;
    setError(null);
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
          <PlayerChips
            players={opponents}
            selectedIds={opponentId ? [opponentId] : []}
            onPress={setOpponentId}
          />
        )}

        {opponentId ? (
          <MatchScoreForm
            firstStep={2}
            sideA="You"
            sideB={opponentName}
            winnerA="You won"
            hint="How many games did each of you win? Any score works — 1–0, 2–1, 3–2, whatever happened."
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
  });
}
