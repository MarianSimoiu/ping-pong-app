import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { PlayerLink } from '@/components/PlayerLink';
import {
  boostLabel,
  canStartThisWeek,
  CHALLENGE_BOOSTS,
  challengeWins,
  fetchChallengeState,
  isOn,
  nextBoost,
  setChallenges,
  type ChallengeOpponent,
  type ChallengeState,
} from '@/lib/challenges';
import { showAlert } from '@/lib/platformAlert';
import { formatDay } from '@/lib/schedule';
import { radius, spacing, useTheme, type Colors } from '@/theme';

// Weekly challenges (lib/challenges.ts) on Home and in Settings: the switch,
// and on Home your week's opponents.

export type Challenges = ReturnType<typeof useChallenges>;

// Your challenges, and switching them on or off. `load(playerId)` once the
// player is known; switching reloads them. Switched on until Wednesday, it
// first asks whether to start this week or next Monday (`choosing`).
export function useChallenges() {
  const playerId = useRef<string | null>(null);
  const [state, setState] = useState<ChallengeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);

  const load = useCallback(async (id?: string) => {
    if (id) playerId.current = id;
    if (!playerId.current) return;
    try {
      setState(await fetchChallengeState(playerId.current));
    } catch {
      // Keeps what it showed; the next visit tries again.
    }
  }, []);

  const set = useCallback(
    async (on: boolean, thisWeek = false) => {
      setBusy(true);
      try {
        await setChallenges(on, thisWeek);
        setChoosing(false);
        await load();
      } catch (e) {
        showAlert(
          on ? 'Couldn’t switch challenges on' : 'Couldn’t switch challenges off',
          e instanceof Error ? e.message : 'Something went wrong',
        );
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const toggle = useCallback(
    (on: boolean) => {
      if (!on) {
        if (choosing) setChoosing(false);
        else void set(false);
      } else if (canStartThisWeek()) {
        setChoosing(true);
      } else {
        void set(true, false);
      }
    },
    [choosing, set],
  );

  return {
    state,
    busy,
    choosing,
    load,
    toggle,
    start: (thisWeek: boolean) => set(true, thisWeek),
    on: !!state && isOn(state),
  };
}

const THE_PITCH = `3 opponents a week, picked so you play people you rarely meet. Win them for bonus rating: ${boostLabel(CHALLENGE_BOOSTS[0])}, then ${boostLabel(CHALLENGE_BOOSTS[1])}, then double.`;

// One line on where you are with challenges (Home's card and Settings).
export function challengeStatus(s: ChallengeState): string {
  if (isOn(s) && s.startsOn! > s.week) return `You’re in from ${formatDay(s.startsOn!)}. Your 3 opponents come then.`;
  if (s.mine.length === 0) {
    return isOn(s) ? 'No opponents yet: not enough active players. We’ll keep looking.' : THE_PITCH;
  }
  const wins = challengeWins(s);
  const next = nextBoost(s);
  if (next) return `This week · ${wins} of ${s.mine.length} won · next win ${boostLabel(next)}`;
  return wins === 3 ? 'This week · 3 of 3 won. A perfect week! 🔥' : `This week · ${wins} of ${s.mine.length} won · all played`;
}

// Settings' line: like the card's, and says when this week's run on after
// switching off.
export function challengeSettingHint(s: ChallengeState): string {
  return !isOn(s) && s.mine.length > 0 ? 'Off from next week. This week’s challenges still count.' : challengeStatus(s);
}

const names = (list: string[]) =>
  list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;

// The switch, with the question it asks when switched on early in the week.
export function ChallengeSwitch({ c }: { c: Challenges }) {
  const { colors } = useTheme();
  return (
    <Switch
      value={c.on || c.choosing}
      onValueChange={c.toggle}
      disabled={c.busy || !c.state}
      accessibilityLabel="Weekly challenges"
      trackColor={{ false: colors.border, true: colors.primary }}
      thumbColor={colors.surface}
    />
  );
}

export function ChallengeStartChoice({ c }: { c: Challenges }) {
  const styles = useStyles();
  if (!c.choosing) return null;
  return (
    <View style={styles.choice}>
      <Text style={styles.choiceText}>Start this week, or next Monday?</Text>
      <View style={styles.choiceButtons}>
        <Pressable
          style={[styles.choiceButton, c.busy && styles.dim]}
          onPress={() => c.start(true)}
          disabled={c.busy}
          accessibilityRole="button"
        >
          <Text style={styles.choiceButtonText}>This week</Text>
        </Pressable>
        <Pressable
          style={[styles.choiceButtonAlt, c.busy && styles.dim]}
          onPress={() => c.start(false)}
          disabled={c.busy}
          accessibilityRole="button"
        >
          <Text style={styles.choiceButtonAltText}>Next Monday</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Home's card: the switch, your week (each opponent: Record, waiting to be
// confirmed, or how it went), and who has you as their challenge.
export function ChallengesCard({
  c,
  waitingWith,
  onRecord,
  onHowItWorks,
}: {
  c: Challenges;
  waitingWith: Set<string>; // opponents with a challenge match waiting to be confirmed
  onRecord: (opponentId: string) => void;
  onHowItWorks: () => void;
}) {
  const styles = useStyles();
  const s = c.state;
  if (!s) return null;
  const open = s.mine.some((m) => m.result === null);

  return (
    <View style={styles.card} testID="challenges-card">
      <View style={styles.header}>
        <Text style={styles.title}>⚡ Weekly challenges</Text>
        <ChallengeSwitch c={c} />
      </View>
      {c.choosing ? <ChallengeStartChoice c={c} /> : <Text style={styles.status}>{challengeStatus(s)}</Text>}
      {!isOn(s) && s.mine.length > 0 && !c.choosing && (
        <Text style={styles.note}>You’re out from next week. This week’s still count.</Text>
      )}
      {s.mine.map((m) => (
        <OpponentRow key={m.opponentId} m={m} waiting={waitingWith.has(m.opponentId)} onRecord={onRecord} />
      ))}
      {s.pickedBy.length > 0 && (
        <Text style={styles.pickedBy}>
          🎯 {names(s.pickedBy.map((p) => p.name))} picked you for a challenge this week.
        </Text>
      )}
      <View style={styles.footer}>
        {open && <Text style={styles.footerText}>Best of 3 or 5, you two decide · ends Sunday</Text>}
        <Pressable onPress={onHowItWorks} hitSlop={8} accessibilityRole="link">
          <Text style={styles.link}>How it works →</Text>
        </Pressable>
      </View>
    </View>
  );
}

function OpponentRow({
  m,
  waiting,
  onRecord,
}: {
  m: ChallengeOpponent;
  waiting: boolean;
  onRecord: (opponentId: string) => void;
}) {
  const styles = useStyles();
  const score = m.score ? `${m.score.mine}–${m.score.theirs}` : '';
  return (
    <View style={styles.row}>
      <PlayerLink playerId={m.opponentId} name={m.name} style={styles.who}>
        <Avatar uri={m.avatarUrl} name={m.name} size={28} playerId={m.opponentId} />
        <Text style={styles.name} numberOfLines={1}>
          {m.name}
        </Text>
        {m.rating !== null && <Text style={styles.rating}>{Math.round(m.rating)}</Text>}
      </PlayerLink>
      {m.result === 'won' ? (
        <Text style={[styles.outcome, styles.won]}>
          Won {score}
          {m.delta !== null ? ` · +${Math.round(m.delta)}` : ''}
          {m.multiplier ? ` (${boostLabel(m.multiplier)})` : ''}
        </Text>
      ) : m.result === 'lost' ? (
        <Text style={[styles.outcome, styles.lost]}>Lost {score}</Text>
      ) : waiting ? (
        <Text style={styles.waiting}>Waiting to be confirmed</Text>
      ) : (
        <Pressable
          style={styles.record}
          onPress={() => onRecord(m.opponentId)}
          accessibilityRole="button"
          accessibilityLabel={`Record your challenge match with ${m.name}`}
        >
          <Text style={styles.recordText}>Record</Text>
        </Pressable>
      )}
    </View>
  );
}

function useStyles() {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [colors]);
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: spacing.lg,
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
    title: { color: colors.text, fontSize: 16, fontWeight: '700', flexShrink: 1 },
    status: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: spacing.xs },
    note: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic', marginTop: spacing.xs },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      marginTop: spacing.xs,
    },
    who: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
    name: { color: colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
    rating: { color: colors.textMuted, fontSize: 12 },
    outcome: { fontSize: 13, fontWeight: '600' },
    won: { color: colors.success },
    lost: { color: colors.danger },
    waiting: { color: colors.textMuted, fontSize: 12 },
    record: {
      backgroundColor: colors.primary,
      borderRadius: radius.sm,
      paddingVertical: spacing.xs + 2,
      paddingHorizontal: spacing.md,
    },
    recordText: { color: colors.primaryText, fontSize: 13, fontWeight: '700' },
    pickedBy: { color: colors.text, fontSize: 13, lineHeight: 18, marginTop: spacing.sm },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    footerText: { color: colors.textMuted, fontSize: 12, flexShrink: 1 },
    link: { color: colors.primary, fontSize: 12, fontWeight: '700' },
    choice: { marginTop: spacing.sm },
    choiceText: { color: colors.text, fontSize: 14, marginBottom: spacing.sm },
    choiceButtons: { flexDirection: 'row', gap: spacing.sm },
    choiceButton: {
      backgroundColor: colors.primary,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.primary,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    choiceButtonText: { color: colors.primaryText, fontWeight: '600' },
    choiceButtonAlt: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    choiceButtonAltText: { color: colors.text, fontWeight: '600' },
    dim: { opacity: 0.5 },
  });
}
