import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DateTimeField } from '@/components/DateTimeField';
import { defaultKickoff, fromLocalInputValue, toLocalInputValue } from '@/lib/countdown';
import { formatKickoff } from '@/lib/format';
import { createTournament } from '@/lib/tournaments';
import type { TournamentsStackScreenProps } from '@/navigation/types';
import { radius, spacing, useTheme, type Colors } from '@/theme';

const BEST_OF_OPTIONS = [3, 5] as const;

// Admins only (the Tournaments tab shows "+ New" to them; the server checks
// too). Opens a tournament for registration until the kickoff time.
export function CreateTournamentScreen({ navigation }: TournamentsStackScreenProps<'CreateTournament'>) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [name, setName] = useState('');
  const [bestOf, setBestOf] = useState(3);
  const [kickoff, setKickoff] = useState(() => toLocalInputValue(defaultKickoff()));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kickoffDate = fromLocalInputValue(kickoff);

  async function onCreate() {
    setError(null);
    if (!name.trim()) {
      setError('Give the tournament a name');
      return;
    }
    if (!kickoffDate) {
      setError('Pick a kickoff date and time');
      return;
    }
    if (kickoffDate.getTime() <= Date.now() + 60_000) {
      setError('Pick a kickoff time in the future');
      return;
    }
    setSubmitting(true);
    try {
      const { tournamentId } = await createTournament({
        name: name.trim(),
        bestOf,
        kickoffAt: kickoffDate.toISOString(),
      });
      // Replace so Back returns to the list, not the create form.
      navigation.replace('TournamentDetail', { tournamentId, name: name.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create tournament');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          placeholder="Winter Cup"
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={setName}
          maxLength={60}
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

        <Text style={styles.label}>Kickoff</Text>
        <DateTimeField
          label="Kickoff date and time"
          value={kickoff}
          onChange={setKickoff}
          min={toLocalInputValue(new Date())}
        />
        {kickoffDate && <Text style={styles.hint}>{formatKickoff(kickoffDate.toISOString())}</Text>}

        <View style={styles.howBox}>
          <Text style={styles.howTitle}>How it works</Text>
          <Text style={styles.how}>
            • Until kickoff, anyone can register themselves and withdraw. Every player gets a
            notification.
          </Text>
          <Text style={styles.how}>
            • Registered players are split into pots by rating (1500 for players with no matches
            yet): 4 pots from 8 players, otherwise 2. Pots change live as people join.
          </Text>
          <Text style={styles.how}>
            • At kickoff the pots freeze and the draw is made: Pot 1 plays Pot 4 and Pot 2 plays
            Pot 3, top seeds get any byes. Everyone is notified of their first opponent.
          </Text>
          <Text style={styles.how}>
            • It needs at least 4 players. You can start it early, move the kickoff, or cancel it
            from the tournament page.
          </Text>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.button, submitting && { opacity: 0.6 }]}
          onPress={onCreate}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color={colors.primaryText} />
          ) : (
            <Text style={styles.buttonText}>Open registration</Text>
          )}
        </Pressable>
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
    hint: { color: colors.textMuted, fontSize: 13, marginTop: spacing.sm },
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
    howBox: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      marginTop: spacing.lg,
      gap: spacing.xs,
    },
    howTitle: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: spacing.xs },
    how: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
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
}
