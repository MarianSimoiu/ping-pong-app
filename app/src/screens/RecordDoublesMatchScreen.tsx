import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MatchScoreForm } from '@/components/MatchScoreForm';
import { PlayerChips } from '@/components/PlayerChips';
import { useAuth } from '@/context/AuthContext';
import { submitDoublesMatch } from '@/lib/doubles';
import { fetchOpponents, type RawGameInput } from '@/lib/matches';
import { showAlert } from '@/lib/platformAlert';
import type { OpponentOption } from '@/lib/types';
import type { DoublesStackScreenProps } from '@/navigation/types';
import { spacing, useTheme, type Colors } from '@/theme';

export function RecordDoublesMatchScreen({ navigation }: DoublesStackScreenProps<'RecordDoublesMatch'>) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { session } = useAuth();
  const [players, setPlayers] = useState<OpponentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [opponentIds, setOpponentIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      setPlayers(await fetchOpponents(session.user.id)); // everyone but you
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load players');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const nameOf = (id: string) => players.find((p) => p.id === id)?.display_name ?? '?';

  function pickPartner(id: string) {
    setPartnerId(id);
    setOpponentIds((prev) => prev.filter((o) => o !== id));
  }

  // Tap to add or remove; with two picked already, a third tap replaces the
  // first one picked.
  function toggleOpponent(id: string) {
    setOpponentIds((prev) => {
      if (prev.includes(id)) return prev.filter((o) => o !== id);
      return prev.length < 2 ? [...prev, id] : [prev[1], id];
    });
  }

  async function onSubmit(games: RawGameInput[]) {
    if (!partnerId || opponentIds.length !== 2) return;
    setError(null);
    setSubmitting(true);
    try {
      await submitDoublesMatch({ partnerId, opponentIds: [opponentIds[0], opponentIds[1]], games });
      showAlert(
        'Match submitted',
        `${nameOf(opponentIds[0])} or ${nameOf(opponentIds[1])} needs to confirm it before team ratings update. They’ll see it on Home and in the Doubles tab.`,
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

  const ready = partnerId !== null && opponentIds.length === 2;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {players.length < 3 ? (
          <Text style={styles.empty}>
            Doubles needs four players. Ask a few more friends to sign up, then record your match.
          </Text>
        ) : (
          <>
            <Text style={styles.label}>1. Your partner</Text>
            <PlayerChips players={players} selectedIds={partnerId ? [partnerId] : []} onPress={pickPartner} />

            {partnerId && (
              <>
                <Text style={styles.label}>2. Opponents</Text>
                <Text style={styles.hint}>Pick two.</Text>
                <PlayerChips
                  players={players.filter((p) => p.id !== partnerId)}
                  selectedIds={opponentIds}
                  onPress={toggleOpponent}
                />
              </>
            )}

            {ready && (
              <MatchScoreForm
                firstStep={3}
                sideA={`You & ${nameOf(partnerId)}`}
                sideB={`${nameOf(opponentIds[0])} & ${nameOf(opponentIds[1])}`}
                winnerA="Your team won"
                hint="How many games did each team win? Any score works — 1–0, 2–1, 3–2, whatever happened."
                submitting={submitting}
                submitError={error}
                onSubmit={onSubmit}
              />
            )}
          </>
        )}

        {!ready && error && <Text style={styles.error}>{error}</Text>}
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
    hint: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.sm },
    empty: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
    error: { color: colors.danger, marginTop: spacing.md, fontSize: 14 },
  });
}
