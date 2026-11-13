import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BottomSheet, SheetButton, SheetHeader } from '@/components/BottomSheet';
import { confirmAction } from '@/lib/platformAlert';
import {
  adminDays,
  clubDay,
  dayLabel,
  formatMatchTime,
  isOverdue,
  pickableDays,
  proposalDays,
  slotMinutes,
  timeOptions,
  type TableTime,
} from '@/lib/schedule';
import { giveWalkover, moveTournamentMatch, proposeMatchTime, type TournamentNode } from '@/lib/tournaments';
import { radius, spacing, useTheme, type Colors } from '@/theme';

// A tournament match's time, picked from the club's hours (lib/schedule.ts):
// the days on a row, then that day's start times; the ones taken on the table
// or already past are greyed out. `current` is the match's time now (shown
// dashed, not pickable).
export function MatchTimePicker({
  days,
  bestOf,
  table,
  matchId,
  current,
  value,
  onChange,
  now,
}: {
  days: string[];
  bestOf: number;
  table: TableTime[];
  matchId: string;
  current: string | null;
  value: string | null;
  onChange: (iso: string | null) => void;
  now: number;
}) {
  const styles = useStyles();
  // Opens on the match's own day when it can be picked.
  const [day, setDay] = useState(() => {
    const start = value ?? current;
    return start && days.includes(clubDay(start)) ? clubDay(start) : days[0];
  });
  const currentMs = current ? new Date(current).getTime() : null;
  const options = timeOptions(day, bestOf, table, matchId, now);

  return (
    <View style={styles.picker}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow}>
        {days.map((d) => (
          <Chip
            key={d}
            label={dayLabel(d, now)}
            selected={d === day}
            onPress={() => {
              setDay(d);
              onChange(null);
            }}
          />
        ))}
      </ScrollView>
      <View style={styles.timeGrid}>
        {options.map((o) => {
          const isCurrent = currentMs === new Date(o.iso).getTime();
          return (
            <Chip
              key={o.hhmm}
              label={o.hhmm}
              selected={value === o.iso}
              disabled={!o.free || isCurrent}
              current={isCurrent}
              accessibilityLabel={`${dayLabel(day, now)} ${o.hhmm}${isCurrent ? ', its time now' : o.past ? ', past' : !o.free ? ', taken' : ''}`}
              onPress={() => onChange(o.iso)}
            />
          );
        })}
      </View>
      <Text style={styles.legend}>
        Bucharest time · {slotMinutes(bestOf)} minutes on the table · greyed out: taken or past
      </Text>
    </View>
  );
}

function Chip({
  label,
  selected,
  disabled,
  current,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  current?: boolean;
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={[styles.chip, selected && styles.chipSelected, current && styles.chipCurrent, disabled && !current && styles.chipDisabled]}
    >
      <Text
        style={[
          styles.chipText,
          selected && styles.chipTextSelected,
          disabled && !current && styles.chipTextDisabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// A player asks to move their match: from today up to a day after the day it
// was set for. It moves once the opponent accepts.
export function ProposeTimeSheet({
  node,
  bestOf,
  table,
  opponent,
  onDismiss,
  onDone,
}: {
  node: TournamentNode;
  bestOf: number;
  table: TableTime[];
  opponent: string;
  onDismiss: () => void;
  onDone: () => void;
}) {
  const styles = useStyles();
  const [now] = useState(() => Date.now());
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = pickableDays(proposalDays(node.plannedOn, now), bestOf, now);

  async function submit() {
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      await proposeMatchTime(node.id, value);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <BottomSheet visible onDismiss={busy ? () => {} : onDismiss} nativeID="propose-time-sheet">
      <SheetHeader
        icon={<Text style={styles.icon}>🗓</Text>}
        title="Propose another time"
        subtitle={`${opponent} has to accept it. Until then it stays ${node.scheduledAt ? formatMatchTime(node.scheduledAt, now) : 'as it is'}.`}
      />
      {days.length > 0 ? (
        <MatchTimePicker
          days={days}
          bestOf={bestOf}
          table={table}
          matchId={node.id}
          current={node.scheduledAt}
          value={value}
          onChange={setValue}
          now={now}
        />
      ) : (
        <Text style={styles.note}>There's no day left to move it to: ask the organizer.</Text>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      <SheetButton
        label={value ? `Propose ${formatMatchTime(value, now)}` : 'Pick a time'}
        onPress={submit}
        busy={busy}
        disabled={!value}
      />
      <SheetButton label="Back" onPress={onDismiss} secondary />
    </BottomSheet>
  );
}

// The organizer's tools for a match waiting to be played: record it, move it
// to any day, or let one player through without playing (a walkover).
export function ManageMatchSheet({
  node,
  tournamentName,
  bestOf,
  roundName,
  table,
  nameOf,
  onRecord,
  onDismiss,
  onDone,
}: {
  node: TournamentNode;
  tournamentName: string;
  bestOf: number;
  roundName: string;
  table: TableTime[];
  nameOf: (id: string | null) => string;
  onRecord: () => void;
  onDismiss: () => void;
  onDone: () => void;
}) {
  const styles = useStyles();
  const [now] = useState(() => Date.now());
  const [mode, setMode] = useState<'menu' | 'move' | 'walkover'>('menu');
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const a = nameOf(node.playerA);
  const b = nameOf(node.playerB);
  const overdue = isOverdue(node, now);

  async function act(kind: string, action: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(null);
    }
  }

  async function walkover(winner: string) {
    const loser = winner === node.playerA ? node.playerB : node.playerA;
    const ok = await confirmAction(
      `${nameOf(winner)} goes through?`,
      `${nameOf(loser)} is out of ${tournamentName}. No match is recorded and ratings don't change. This can't be undone.`,
      'Give walkover',
    );
    if (ok) act('walkover', () => giveWalkover(node.id, winner));
  }

  const back = () => {
    setMode('menu');
    setValue(null);
    setError(null);
  };
  const close = busy ? () => {} : onDismiss;

  if (mode === 'move') {
    return (
      <BottomSheet visible onDismiss={close} nativeID="move-match-sheet">
        <SheetHeader
          icon={<Text style={styles.icon}>🗓</Text>}
          title={`Move ${a} v ${b}`}
          subtitle={`Any day in the next 3 weeks. Both players are told.${node.scheduledAt ? ` Now: ${formatMatchTime(node.scheduledAt, now)}.` : ''}`}
        />
        <MatchTimePicker
          days={pickableDays(adminDays(now), bestOf, now)}
          bestOf={bestOf}
          table={table}
          matchId={node.id}
          current={node.scheduledAt}
          value={value}
          onChange={setValue}
          now={now}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <SheetButton
          label={value ? `Move to ${formatMatchTime(value, now)}` : 'Pick a time'}
          onPress={() => value && act('move', () => moveTournamentMatch(node.id, value))}
          busy={busy === 'move'}
          disabled={!value}
        />
        <SheetButton label="Back" onPress={back} secondary />
      </BottomSheet>
    );
  }

  if (mode === 'walkover') {
    return (
      <BottomSheet visible onDismiss={close} nativeID="walkover-sheet">
        <SheetHeader
          icon={<Text style={styles.icon}>🏳️</Text>}
          title="Give a walkover"
          subtitle="Who goes through? The match isn't played and ratings don't change."
        />
        {[node.playerA, node.playerB].map((id) => (
          <ActionButton
            key={id}
            label={`${nameOf(id)} goes through`}
            onPress={() => id && walkover(id)}
            busy={busy === 'walkover'}
            disabled={busy !== null}
            variant="outline"
          />
        ))}
        {error && <Text style={styles.error}>{error}</Text>}
        <SheetButton label="Back" onPress={back} secondary />
      </BottomSheet>
    );
  }

  const when = node.scheduledAt ? formatMatchTime(node.scheduledAt, now) : 'No time yet';
  return (
    <BottomSheet visible onDismiss={close} nativeID="manage-match-sheet">
      <SheetHeader
        icon={<Text style={styles.icon}>🏓</Text>}
        title={`${a} v ${b}`}
        subtitle={`${roundName} · ${overdue ? `wasn't played: due ${when}` : when}`}
      />
      {node.proposedAt && (
        <Text style={styles.note}>
          {nameOf(node.proposedBy)} asked to move it to {formatMatchTime(node.proposedAt, now)}; waiting for{' '}
          {nameOf(node.proposedBy === node.playerA ? node.playerB : node.playerA)}.
        </Text>
      )}
      <ActionButton label="Record result" onPress={onRecord} disabled={busy !== null} />
      <ActionButton label="Move to another time" onPress={() => setMode('move')} variant="outline" disabled={busy !== null} />
      <ActionButton label="Give a walkover" onPress={() => setMode('walkover')} variant="outline" disabled={busy !== null} />
      {error && <Text style={styles.error}>{error}</Text>}
      <SheetButton label="Close" onPress={onDismiss} secondary />
    </BottomSheet>
  );
}

function ActionButton({
  label,
  onPress,
  variant = 'primary',
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'outline';
  busy?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={[styles.action, variant === 'outline' && styles.actionOutline, disabled && !busy && styles.actionDisabled]}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'primary' ? colors.primaryText : colors.text} />
      ) : (
        <Text style={[styles.actionText, variant === 'outline' && styles.actionTextOutline]}>{label}</Text>
      )}
    </Pressable>
  );
}

function useStyles() {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [colors]);
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    icon: { fontSize: 32 },
    picker: { gap: spacing.sm },
    dayRow: { gap: spacing.sm, paddingVertical: 2 },
    timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingVertical: spacing.sm,
      paddingHorizontal: 14,
      minWidth: 64,
      alignItems: 'center',
    },
    chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipCurrent: { borderColor: colors.primary, borderStyle: 'dashed' },
    chipDisabled: { backgroundColor: colors.surfaceAlt, borderColor: colors.surfaceAlt },
    chipText: { color: colors.text, fontSize: 15, fontWeight: '600' },
    chipTextSelected: { color: colors.primaryText },
    chipTextDisabled: { color: colors.textMuted, textDecorationLine: 'line-through' },
    legend: { color: colors.textMuted, fontSize: 12 },
    note: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
    error: { color: colors.danger, fontSize: 14 },
    action: {
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 46,
    },
    actionOutline: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    actionDisabled: { opacity: 0.45 },
    actionText: { color: colors.primaryText, fontSize: 15, fontWeight: '700' },
    actionTextOutline: { color: colors.text },
  });
}
