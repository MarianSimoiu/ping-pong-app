import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Countdown } from '@/components/Countdown';
import { DateTimeField } from '@/components/DateTimeField';
import { ManageMatchSheet, ProposeTimeSheet } from '@/components/MatchSheets';
import { PotRules, PotsList, withYou } from '@/components/PotsList';
import { useAuth } from '@/context/AuthContext';
import { pickChampionLine } from '@/lib/commentary';
import { MIN_MATCHES_FOR_LEADERBOARD } from '@/lib/constants';
import { defaultKickoff, fromLocalInputValue, toLocalInputValue, useNow } from '@/lib/countdown';
import { formatKickoff } from '@/lib/format';
import { groupByPot } from '@/lib/pots';
import { confirmAction } from '@/lib/platformAlert';
import { fetchIsAdmin, fetchMyProfile } from '@/lib/players';
import {
  clubDay,
  formatDayRange,
  formatMatchTime,
  isOverdue,
  pickableDays,
  proposalDays,
} from '@/lib/schedule';
import {
  answerMatchTime,
  cancelTournament,
  fetchTournamentDetail,
  isPastKickoff,
  MIN_TOURNAMENT_PLAYERS,
  registerForTournament,
  requestKickoff,
  rescheduleTournament,
  setRoundDates,
  startTournamentNow,
  withdrawFromTournament,
  type TournamentDetail,
  type TournamentNode,
} from '@/lib/tournaments';
import type { TournamentsStackScreenProps } from '@/navigation/types';
import { radius, spacing, useTheme, type Colors } from '@/theme';

// As the server's notifications name them (_shared/rounds.ts).
function roundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  if (fromEnd === 3) return 'Round of 16';
  if (fromEnd === 4) return 'Round of 32';
  return `Round ${round}`;
}

// Where the signed-in player stands in a drawn bracket.
type MyPath =
  | { kind: 'play'; node: TournamentNode; opponent: string }
  | { kind: 'wait'; node: TournamentNode; winnerOf: [string, string] | null }
  | { kind: 'out'; round: number; by: string | null }
  | { kind: 'won' };

function myPath(nodes: TournamentNode[], meId: string): MyPath | null {
  const mine = nodes.filter((n) => n.playerA === meId || n.playerB === meId);
  if (mine.length === 0) return null;
  const lost = mine.find((n) => n.status === 'completed' && n.winnerId && n.winnerId !== meId);
  if (lost) return { kind: 'out', round: lost.round, by: lost.playerA === meId ? lost.playerB : lost.playerA };
  const next = mine.filter((n) => n.status !== 'completed').sort((a, b) => a.round - b.round)[0];
  if (!next) return { kind: 'won' };
  const isA = next.playerA === meId;
  const opponent = isA ? next.playerB : next.playerA;
  if (opponent) return { kind: 'play', node: next, opponent };
  // Side A of a match is fed by slot 2s of the round before, side B by 2s + 1.
  const feeder = nodes.find((n) => n.round === next.round - 1 && n.slot === next.slot * 2 + (isA ? 1 : 0));
  return {
    kind: 'wait',
    node: next,
    winnerOf: feeder?.playerA && feeder.playerB ? [feeder.playerA, feeder.playerB] : null,
  };
}

// A first-round "match" that was only a bye.
const isBye = (n: TournamentNode) => n.round === 1 && n.status === 'completed' && (!n.playerA || !n.playerB);

type Me = { id: string; matchesPlayed: number };

const POTS_REFRESH_MS = 30_000;
// While it's being played: new times, proposals and results from others.
const BRACKET_REFRESH_MS = 60_000;
type Busy =
  | 'register'
  | 'withdraw'
  | 'start'
  | 'reschedule'
  | 'cancel'
  | 'accept'
  | 'decline'
  | 'takeBack'
  | 'dates'
  | null;
type Sheet = { kind: 'propose' | 'manage'; nodeId: string } | null;

export function TournamentDetailScreen({ route, navigation }: TournamentsStackScreenProps<'TournamentDetail'>) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { tournamentId } = route.params;
  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [newKickoff, setNewKickoff] = useState('');
  const [sheet, setSheet] = useState<Sheet>(null);
  // An admin changing a round's days, and what came of the last change.
  const [editingRound, setEditingRound] = useState<{ round: number; startsOn: string; endsOn: string } | null>(null);
  const [roundNotice, setRoundNotice] = useState<{ round: number; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [d, profile, admin] = await Promise.all([
        fetchTournamentDetail(tournamentId),
        userId ? fetchMyProfile(userId).catch(() => null) : Promise.resolve(null),
        userId ? fetchIsAdmin(userId).catch(() => false) : Promise.resolve(false),
      ]);
      setDetail(d);
      setMe(profile ? { id: profile.id, matchesPlayed: profile.rating?.matches_played ?? 0 } : null);
      setIsAdmin(admin);
      // Opened from a notification, the route has no name yet.
      navigation.setOptions({ title: d.tournament.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tournament');
    } finally {
      setLoading(false);
    }
  }, [tournamentId, userId, navigation]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const isOpen = detail?.tournament.status === 'registration';
  const now = useNow(isOpen ? 1000 : null);

  // While registration is open the pots move as people join, withdraw or play
  // rated matches: keep the page current while it's on screen.
  useFocusEffect(
    useCallback(() => {
      if (!isOpen) return;
      const refresh = setInterval(load, POTS_REFRESH_MS);
      return () => clearInterval(refresh);
    }, [isOpen, load]),
  );
  const isActive = detail?.tournament.status === 'active';
  useFocusEffect(
    useCallback(() => {
      if (!isActive) return;
      const refresh = setInterval(load, BRACKET_REFRESH_MS);
      return () => clearInterval(refresh);
    }, [isActive, load]),
  );
  const pastKickoff = !!detail && isPastKickoff(detail.tournament, now);
  const drawDue = pastKickoff && (detail?.participants.length ?? 0) >= MIN_TOURNAMENT_PLAYERS;

  // The kickoff has come with enough players: ask for the draw right away
  // (the server also does it on its own within a minute), then check back
  // until it's there.
  const askedForDraw = useRef(false);
  useEffect(() => {
    if (!drawDue) return;
    if (!askedForDraw.current) {
      askedForDraw.current = true;
      requestKickoff()
        .catch(() => {})
        .then(load);
    }
    const poll = setInterval(load, 10_000);
    return () => clearInterval(poll);
  }, [drawDue, load]);

  // When the draw replaces the registration page (or a tournament is
  // cancelled), start the new page from the top.
  const scrollRef = useRef<ScrollView>(null);
  const status = detail?.tournament.status;
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [status]);

  // Computed before the early returns below so the hook order stays stable.
  const champion =
    detail?.tournament.status === 'completed'
      ? detail.nodes.find((n) => n.round === detail.totalRounds)?.winnerId ?? null
      : null;
  const championName = champion ? detail?.nameById[champion] : null;
  // Picked once per champion so it doesn't change on every re-render/refresh.
  const championLine = useMemo(() => (championName ? pickChampionLine(championName) : null), [championName]);

  if (loading && !detail) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xl }} />
      </SafeAreaView>
    );
  }
  if (error || !detail) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.error}>{error ?? 'Not found'}</Text>
      </SafeAreaView>
    );
  }

  const { tournament, participants, nodes, nameById, totalRounds, rounds: roundDays, table } = detail;
  const count = participants.length;
  const meId = me?.id ?? null;
  const myEntry = meId ? participants.find((p) => p.playerId === meId) : undefined;
  const myRank = meId
    ? groupByPot(participants)
        .flatMap((g) => g.players)
        .find((p) => p.playerId === meId)?.rank ?? null
    : null;
  const nameOf = (id: string | null, fallback: string) => (id ? nameById[id] ?? 'Unknown' : fallback);
  const players = (n: number) => `${n} ${n === 1 ? 'player' : 'players'}`;

  async function run(kind: Busy, action: () => Promise<void>) {
    setBusy(kind);
    setActionError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  async function withdraw() {
    const ok = await confirmAction(`Withdraw from ${tournament.name}?`, 'You can register again until kickoff.', 'Withdraw');
    if (ok) run('withdraw', () => withdrawFromTournament(tournamentId));
  }

  async function startNow() {
    const ok = await confirmAction(
      `Start ${tournament.name} now?`,
      `Registration closes and the draw is made with the ${players(count)} registered. Everyone is told who they play.`,
      'Start now',
    );
    if (ok) run('start', () => startTournamentNow(tournamentId));
  }

  async function cancel() {
    const ok = await confirmAction(
      `Cancel ${tournament.name}?`,
      "The registered players are told. This can't be undone.",
      'Cancel tournament',
    );
    if (ok) run('cancel', () => cancelTournament(tournamentId));
  }

  function openReschedule() {
    const current = tournament.kickoffAt ? new Date(tournament.kickoffAt) : null;
    setNewKickoff(toLocalInputValue(current && current.getTime() > Date.now() ? current : defaultKickoff()));
    setActionError(null);
    setRescheduling(true);
  }

  function saveReschedule() {
    const date = fromLocalInputValue(newKickoff);
    if (!date || date.getTime() <= Date.now() + 60_000) {
      setActionError('Pick a kickoff time in the future');
      return;
    }
    run('reschedule', async () => {
      await rescheduleTournament(tournamentId, date.toISOString());
      setRescheduling(false);
    });
  }

  function onNodePress(node: TournamentNode) {
    if (node.status !== 'ready' || !node.playerA || !node.playerB) return;
    navigation.navigate('RecordTournamentMatch', {
      tournamentMatchId: node.id,
      tournamentId,
      playerAName: nameOf(node.playerA, 'A'),
      playerBName: nameOf(node.playerB, 'B'),
      bestOf: tournament.bestOf,
    });
  }

  // The players of a match, its organizer and admins can record it (as the
  // server allows).
  const canRecord = (node: TournamentNode) =>
    !!meId && (node.playerA === meId || node.playerB === meId || tournament.createdBy === meId || isAdmin);
  // Admins can also move a match waiting to be played or give a walkover.
  const canManage = (node: TournamentNode) =>
    isAdmin && tournament.status === 'active' && node.status === 'ready' && !!node.playerA && !!node.playerB;

  function onMatchPress(node: TournamentNode) {
    if (canManage(node)) {
      setActionError(null);
      setSheet({ kind: 'manage', nodeId: node.id });
    } else if (node.status === 'ready' && canRecord(node)) {
      onNodePress(node);
    }
  }

  const clock = Date.now();
  const roundDates = (round: number) => roundDays.find((r) => r.round === round) ?? null;
  const sheetNode = sheet ? nodes.find((n) => n.id === sheet.nodeId) ?? null : null;
  const closeSheet = () => setSheet(null);
  const sheetDone = () => {
    setSheet(null);
    load();
  };

  function openRoundDates(round: number) {
    const dates = roundDates(round);
    const today = clubDay(clock);
    setRoundNotice(null);
    setActionError(null);
    setEditingRound({ round, startsOn: dates?.startsOn ?? today, endsOn: dates?.endsOn ?? today });
  }

  function saveRoundDates() {
    if (!editingRound) return;
    const { round, startsOn, endsOn } = editingRound;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) {
      setActionError('Pick the first and last day');
      return;
    }
    if (endsOn < startsOn) {
      setActionError("The last day can't be before the first");
      return;
    }
    run('dates', async () => {
      const { moved } = await setRoundDates({ tournamentId, round, startsOn, endsOn });
      setEditingRound(null);
      setRoundNotice({
        round,
        text:
          moved === 0
            ? 'Saved. Every match already fits these days.'
            : `Saved. ${moved === 1 ? '1 match has' : `${moved} matches have`} a new time in these days; the players are told.`,
      });
    });
  }

  const button = (
    label: string,
    onPress: () => void,
    kind: Busy,
    variant: 'primary' | 'secondary' | 'danger' = 'primary',
    disabled = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      style={[
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        (disabled || (busy !== null && (kind === null || busy !== kind))) && styles.buttonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled || busy !== null}
    >
      {kind !== null && busy === kind ? (
        <ActivityIndicator color={variant === 'primary' ? colors.primaryText : colors.text} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            variant === 'secondary' && styles.buttonTextSecondary,
            variant === 'danger' && styles.buttonTextDanger,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );

  // --- Open for registration -------------------------------------------------

  function renderRegistration() {
    const missing = MIN_MATCHES_FOR_LEADERBOARD - (me?.matchesPlayed ?? 0);
    let status: React.ReactNode = null;
    if (pastKickoff && drawDue) {
      status = (
        <View style={[styles.card, styles.centerRow]}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.cardTitle}>Making the draw…</Text>
        </View>
      );
    } else if (pastKickoff) {
      status = (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Registration closed</Text>
          <Text style={styles.cardText}>
            Kickoff came with {players(count)}; a tournament needs at least {MIN_TOURNAMENT_PLAYERS}. Waiting for the
            organizer to move the kickoff or cancel.
          </Text>
        </View>
      );
    } else if (myEntry) {
      status = (
        <View style={[styles.card, styles.cardHighlight]}>
          <Text style={styles.cardTitle}>✓ You're registered</Text>
          {myEntry.pot !== null && (
            <Text style={styles.potLine}>
              {myRank !== null ? (
                <>
                  You're <Text style={styles.potStrong}>#{myRank}</Text> of {count} →{' '}
                </>
              ) : (
                "You're in "
              )}
              <Text style={styles.potStrong}>Pot {myEntry.pot}</Text> for now
            </Text>
          )}
          <Text style={styles.cardText}>
            Your pot can change until kickoff as players join, withdraw or play rated matches (see the pots below).
            You'll get a notification with your first opponent.
          </Text>
          {button('Withdraw', withdraw, 'withdraw', 'secondary')}
        </View>
      );
    } else if (me && missing > 0) {
      status = (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Not on the leaderboard yet</Text>
          <Text style={styles.cardText}>
            Play {missing} more {missing === 1 ? 'match' : 'matches'} to register. Tournaments are for players on the
            leaderboard ({MIN_MATCHES_FOR_LEADERBOARD}+ confirmed matches).
          </Text>
        </View>
      );
    } else if (me) {
      status = (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Registration is open</Text>
          <Text style={styles.cardText}>Join before kickoff and see which pot your rating puts you in.</Text>
          {button('Register', () => run('register', () => registerForTournament(tournamentId)), 'register')}
        </View>
      );
    }

    return (
      <>
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>{pastKickoff ? 'Kickoff time has come' : 'Kickoff in'}</Text>
          {!pastKickoff && tournament.kickoffAt && <Countdown to={tournament.kickoffAt} now={now} />}
          <Text style={styles.heroMeta}>
            {tournament.kickoffAt ? formatKickoff(tournament.kickoffAt) : ''} · Best of {tournament.bestOf} ·{' '}
            {count} registered
          </Text>
        </View>

        {status}
        {actionError && !rescheduling && <Text style={styles.actionError}>{actionError}</Text>}

        {isAdmin && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Organizer</Text>
            {button('Start now', startNow, 'start', 'primary', count < MIN_TOURNAMENT_PLAYERS)}
            {count < MIN_TOURNAMENT_PLAYERS && (
              <Text style={styles.cardNote}>
                Starting needs at least {MIN_TOURNAMENT_PLAYERS} players ({count} so far).
              </Text>
            )}
            {rescheduling ? (
              <View style={styles.reschedule}>
                <Text style={styles.cardNote}>New kickoff</Text>
                <DateTimeField
                  label="New kickoff date and time"
                  value={newKickoff}
                  onChange={setNewKickoff}
                  min={toLocalInputValue(new Date())}
                />
                {actionError && <Text style={styles.actionError}>{actionError}</Text>}
                <View style={styles.buttonRow}>
                  <View style={{ flex: 1 }}>{button('Save', saveReschedule, 'reschedule')}</View>
                  <View style={{ flex: 1 }}>
                    {button('Back', () => (setRescheduling(false), setActionError(null)), null, 'secondary')}
                  </View>
                </View>
              </View>
            ) : (
              button('Move kickoff', openReschedule, 'reschedule', 'secondary')
            )}
            {button('Cancel tournament', cancel, 'cancel', 'danger')}
          </View>
        )}

        <View style={styles.sectionRow}>
          <Text style={[styles.sectionLabel, styles.sectionLabelInRow]}>Pots</Text>
          <Text style={styles.live}>● Live · refreshes every 30 s</Text>
        </View>
        <PotRules count={count} />
        {count > 0 && <PotsList participants={participants} meId={meId} mode="live" />}
      </>
    );
  }

  // --- Drawn: the bracket ----------------------------------------------------

  function renderMyPath() {
    if (!meId) return null;
    const path = myPath(nodes, meId);
    if (!path || path.kind === 'won') return null;
    if (path.kind === 'out') {
      return (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>You're out</Text>
          <Text style={styles.cardText}>
            Lost {path.by ? `to ${nameOf(path.by, '')} ` : ''}in the {roundLabel(path.round, totalRounds).toLowerCase()}.
          </Text>
        </View>
      );
    }
    const round = roundLabel(path.node.round, totalRounds);
    if (path.kind === 'play') {
      const node = path.node;
      const opponent = nameOf(path.opponent, '');
      const ready = node.status === 'ready';
      const overdue = isOverdue(node, clock);
      const askedByThem = ready && !!node.proposedAt && node.proposedBy === path.opponent;
      const askedByMe = ready && !!node.proposedAt && node.proposedBy === meId;
      const canPropose =
        ready &&
        !!node.scheduledAt &&
        !node.proposedAt &&
        !overdue &&
        pickableDays(proposalDays(node.plannedOn, clock), tournament.bestOf, clock).length > 0;
      return (
        <View style={[styles.card, styles.cardHighlight]}>
          <Text style={styles.cardKicker}>Your match · {round}</Text>
          <Text style={styles.versus}>vs {opponent}</Text>
          {ready && node.scheduledAt && (
            <Text style={[styles.when, overdue && styles.whenOverdue]}>🗓 {formatMatchTime(node.scheduledAt, clock)}</Text>
          )}
          {overdue && (
            <Text style={styles.cardText}>
              It wasn't played on its day. Play it and record the result soon: the organizer has been told and decides
              what happens next.
            </Text>
          )}
          {askedByThem && (
            <View style={styles.proposal}>
              <Text style={styles.proposalText}>
                {opponent} asks to move it to <Text style={styles.strong}>{formatMatchTime(node.proposedAt!, clock)}</Text>.
              </Text>
              <View style={styles.buttonRow}>
                <View style={{ flex: 1 }}>
                  {button('Accept', () => run('accept', () => answerMatchTime(node.id, 'accept')), 'accept')}
                </View>
                <View style={{ flex: 1 }}>
                  {button(
                    'Keep the time',
                    () => run('decline', () => answerMatchTime(node.id, 'decline')),
                    'decline',
                    'secondary',
                  )}
                </View>
              </View>
            </View>
          )}
          {askedByMe && (
            <View style={styles.proposal}>
              <Text style={styles.proposalText}>
                You asked to move it to <Text style={styles.strong}>{formatMatchTime(node.proposedAt!, clock)}</Text>.
                Waiting for {opponent} to accept.
              </Text>
              {button(
                'Take it back',
                () => run('takeBack', () => answerMatchTime(node.id, 'withdraw')),
                'takeBack',
                'secondary',
              )}
            </View>
          )}
          {canPropose &&
            button(
              'Propose another time',
              () => {
                setActionError(null);
                setSheet({ kind: 'propose', nodeId: node.id });
              },
              null,
              'secondary',
            )}
          {ready && button('Record result', () => onNodePress(node), null)}
        </View>
      );
    }
    const dates = roundDates(path.node.round);
    return (
      <View style={styles.card}>
        <Text style={styles.cardKicker}>
          Up next · {round}
          {dates ? ` · ${formatDayRange(dates.startsOn, dates.endsOn)}` : ''}
        </Text>
        <Text style={styles.cardText}>
          {path.winnerOf
            ? `You play the winner of ${nameOf(path.winnerOf[0], '')} v ${nameOf(path.winnerOf[1], '')}.`
            : 'Your opponent is decided by an earlier match.'}{' '}
          Your match gets its time as soon as they've played.
        </Text>
      </View>
    );
  }

  // Admins: the matches not played on their day, to decide.
  function renderOverdue() {
    if (!isAdmin || tournament.status !== 'active') return null;
    const late = nodes.filter((n) => isOverdue(n, clock));
    if (late.length === 0) return null;
    return (
      <View style={[styles.card, styles.cardWarning]}>
        <Text style={styles.cardKicker}>Organizer</Text>
        <Text style={styles.cardTitle}>
          ⚠ {late.length === 1 ? "1 match wasn't played on its day" : `${late.length} matches weren't played on their day`}
        </Text>
        <Text style={styles.cardText}>Record the result, move it to another time, or give a walkover.</Text>
        {late.map((n) => (
          <Pressable
            key={n.id}
            accessibilityRole="button"
            style={styles.lateRow}
            onPress={() => onMatchPress(n)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.lateName}>
                {nameOf(n.playerA, '?')} v {nameOf(n.playerB, '?')}
              </Text>
              <Text style={styles.lateMeta}>
                {roundLabel(n.round, totalRounds)} · due {formatMatchTime(n.scheduledAt!, clock)}
              </Text>
            </View>
            <Text style={styles.record}>Decide ›</Text>
          </Pressable>
        ))}
      </View>
    );
  }

  function renderRoundHeader(round: number) {
    const dates = roundDates(round);
    const name = roundLabel(round, totalRounds);
    const editable = isAdmin && tournament.status === 'active' && !!dates && editingRound?.round !== round;
    return (
      <View style={styles.roundHeader}>
        <Text style={[styles.sectionLabel, styles.sectionLabelInRow, { flex: 1 }]}>{name}</Text>
        {dates && <Text style={styles.roundDates}>{formatDayRange(dates.startsOn, dates.endsOn)}</Text>}
        {editable && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Change the days of the ${name.toLowerCase()}`}
            onPress={() => openRoundDates(round)}
            hitSlop={8}
            disabled={busy !== null}
          >
            <Text style={styles.editLink}>Edit</Text>
          </Pressable>
        )}
      </View>
    );
  }

  function renderRoundEditor(round: number) {
    if (!editingRound || editingRound.round !== round) return null;
    const today = clubDay(clock);
    return (
      <View style={styles.card}>
        <Text style={styles.cardNote}>
          Days for the {roundLabel(round, totalRounds).toLowerCase()}. Its matches outside them get new times in them
          (11:00 to 18:00), and the players are told.
        </Text>
        <View style={styles.buttonRow}>
          <View style={styles.dateField}>
            <Text style={styles.fieldLabel}>First day</Text>
            <DateTimeField
              mode="date"
              label="First day"
              value={editingRound.startsOn}
              onChange={(v) => setEditingRound({ ...editingRound, startsOn: v })}
            />
          </View>
          <View style={styles.dateField}>
            <Text style={styles.fieldLabel}>Last day</Text>
            <DateTimeField
              mode="date"
              label="Last day"
              value={editingRound.endsOn}
              min={today}
              onChange={(v) => setEditingRound({ ...editingRound, endsOn: v })}
            />
          </View>
        </View>
        {actionError && <Text style={styles.actionError}>{actionError}</Text>}
        <View style={styles.buttonRow}>
          <View style={{ flex: 1 }}>{button('Save', saveRoundDates, 'dates')}</View>
          <View style={{ flex: 1 }}>
            {button('Back', () => (setEditingRound(null), setActionError(null)), null, 'secondary')}
          </View>
        </View>
      </View>
    );
  }

  function renderBracket() {
    const rounds = Array.from(new Set(nodes.map((n) => n.round))).sort((a, b) => a - b);
    const byes = nodes.filter(isBye).length;
    const hasPots = participants.some((p) => p.pot !== null);
    return (
      <>
        {championLine && (
          <View style={styles.champion}>
            <Text style={styles.championEmoji}>🏆</Text>
            <Text style={styles.championText}>{championLine}</Text>
          </View>
        )}
        {tournament.status === 'active' && renderMyPath()}
        {actionError && !editingRound && <Text style={styles.actionError}>{actionError}</Text>}
        {renderOverdue()}
        {tournament.status === 'active' && roundDays.length > 0 && (
          <Text style={styles.scheduleHint}>
            🗓 One table, 11:00 to 18:00 Bucharest time. Each match gets the first free slot on its round's days as
            soon as both players are known; the two players can agree another time, up to a day later.
          </Text>
        )}

        {rounds.map((round) => {
          const shown = nodes.filter((n) => n.round === round && !isBye(n));
          return (
            <View key={round}>
              {renderRoundHeader(round)}
              {round === 1 && byes > 0 && (
                <Text style={styles.sectionHint}>
                  {byes === 1 ? '1 player has' : `${byes} players have`} a bye into round 2.
                </Text>
              )}
              {renderRoundEditor(round)}
              {roundNotice?.round === round && <Text style={styles.notice}>{roundNotice.text}</Text>}
              {shown.map((node) => {
                const isReady = node.status === 'ready';
                const mine = !!meId && (node.playerA === meId || node.playerB === meId);
                const manageable = canManage(node);
                const recordable = isReady && canRecord(node);
                const overdue = isOverdue(node, clock);
                return (
                  <Pressable
                    key={node.id}
                    accessibilityRole={manageable || recordable ? 'button' : undefined}
                    style={[styles.match, isReady && styles.matchReady, mine && styles.matchMine]}
                    onPress={() => onMatchPress(node)}
                    disabled={!manageable && !recordable}
                  >
                    <View style={{ flex: 1 }}>
                      <PlayerLine
                        name={nameOf(node.playerA, node.status === 'pending' ? 'TBD' : 'Bye')}
                        isWinner={!!node.winnerId && node.winnerId === node.playerA}
                        isMe={!!meId && node.playerA === meId}
                      />
                      <View style={styles.divider} />
                      <PlayerLine
                        name={nameOf(node.playerB, node.status === 'pending' ? 'TBD' : 'Bye')}
                        isWinner={!!node.winnerId && node.winnerId === node.playerB}
                        isMe={!!meId && node.playerB === meId}
                      />
                      {isReady && node.scheduledAt && (
                        <View style={styles.metaRow}>
                          <Text style={[styles.meta, overdue && styles.metaOverdue]}>
                            🗓 {formatMatchTime(node.scheduledAt, clock)}
                          </Text>
                          {overdue && <Text style={[styles.tag, styles.tagDanger]}>Overdue</Text>}
                          {node.proposedAt && <Text style={styles.tag}>New time asked</Text>}
                        </View>
                      )}
                      {node.walkover && (
                        <View style={styles.metaRow}>
                          <Text style={styles.tag}>Walkover</Text>
                        </View>
                      )}
                    </View>
                    {manageable ? (
                      <Text style={styles.record}>Manage ›</Text>
                    ) : (
                      recordable && <Text style={styles.record}>Record ›</Text>
                    )}
                    {node.status === 'completed' && <Text style={styles.done}>✓</Text>}
                  </Pressable>
                );
              })}
            </View>
          );
        })}

        {hasPots && (
          <>
            <Text style={styles.sectionLabel}>Pots at the draw</Text>
            <PotsList participants={participants} meId={meId} mode="frozen" />
          </>
        )}
      </>
    );
  }

  function renderCancelled() {
    return (
      <>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Cancelled</Text>
          <Text style={styles.cardText}>The organizer called this tournament off before the draw.</Text>
        </View>
        {count > 0 && (
          <>
            <Text style={styles.sectionLabel}>Had registered</Text>
            <PotsList participants={participants} meId={meId} mode="plain" />
          </>
        )}
      </>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        {tournament.status === 'registration'
          ? renderRegistration()
          : tournament.status === 'cancelled'
            ? renderCancelled()
            : renderBracket()}
      </ScrollView>
      {sheet?.kind === 'propose' && sheetNode?.status === 'ready' && (
        <ProposeTimeSheet
          node={sheetNode}
          bestOf={tournament.bestOf}
          table={table}
          opponent={nameOf(sheetNode.playerA === meId ? sheetNode.playerB : sheetNode.playerA, 'Your opponent')}
          onDismiss={closeSheet}
          onDone={sheetDone}
        />
      )}
      {sheet?.kind === 'manage' && sheetNode && canManage(sheetNode) && (
        <ManageMatchSheet
          node={sheetNode}
          tournamentName={tournament.name}
          bestOf={tournament.bestOf}
          roundName={roundLabel(sheetNode.round, totalRounds)}
          table={table}
          nameOf={(id) => nameOf(id, '?')}
          onRecord={() => {
            setSheet(null);
            onNodePress(sheetNode);
          }}
          onDismiss={closeSheet}
          onDone={sheetDone}
        />
      )}
    </SafeAreaView>
  );
}

function PlayerLine({ name, isWinner, isMe }: { name: string; isWinner: boolean; isMe: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Text style={[styles.player, isMe && styles.playerMe, isWinner && styles.winner]} numberOfLines={1}>
      {withYou(name, isMe)}
    </Text>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg, paddingBottom: spacing.xl },
    hero: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    heroLabel: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      textAlign: 'center',
    },
    heroMeta: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    cardHighlight: { borderColor: colors.primary },
    cardWarning: { borderColor: colors.danger },
    centerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    cardTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
    cardKicker: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    versus: { color: colors.text, fontSize: 22, fontWeight: '800' },
    when: { color: colors.text, fontSize: 16, fontWeight: '700' },
    whenOverdue: { color: colors.danger },
    proposal: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.sm,
      padding: spacing.md - 4,
      gap: spacing.sm,
    },
    proposalText: { color: colors.text, fontSize: 15, lineHeight: 21 },
    strong: { fontWeight: '700' },
    lateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: spacing.sm,
    },
    lateName: { color: colors.text, fontSize: 15, fontWeight: '600' },
    lateMeta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
    scheduleHint: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginBottom: spacing.xs },
    roundHeader: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: spacing.sm,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    roundDates: { color: colors.text, fontSize: 13, fontWeight: '600' },
    editLink: { color: colors.primary, fontSize: 13, fontWeight: '700' },
    dateField: { flex: 1, gap: spacing.xs },
    fieldLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
    notice: { color: colors.success, fontSize: 13, fontWeight: '600', marginBottom: spacing.sm },
    metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
    meta: { color: colors.textMuted, fontSize: 13, fontWeight: '600', marginRight: spacing.xs },
    metaOverdue: { color: colors.danger },
    tag: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 2,
      overflow: 'hidden',
    },
    tagDanger: { color: colors.danger, borderColor: colors.danger },
    cardText: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
    cardNote: { color: colors.textMuted, fontSize: 13 },
    potLine: { color: colors.text, fontSize: 16 },
    potStrong: { color: colors.primary, fontWeight: '800' },
    reschedule: { gap: spacing.sm },
    buttonRow: { flexDirection: 'row', gap: spacing.sm },
    button: {
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 46,
    },
    buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    buttonDanger: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger },
    buttonDisabled: { opacity: 0.45 },
    buttonText: { color: colors.primaryText, fontSize: 15, fontWeight: '700' },
    buttonTextSecondary: { color: colors.text },
    buttonTextDanger: { color: colors.danger },
    actionError: { color: colors.danger, fontSize: 14, marginBottom: spacing.sm },
    sectionLabel: {
      color: colors.textMuted,
      fontSize: 13,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    sectionHint: { color: colors.textMuted, fontSize: 13, marginTop: -4, marginBottom: spacing.sm },
    sectionRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    sectionLabelInRow: { marginTop: 0, marginBottom: 0 },
    live: { color: colors.success, fontSize: 12, fontWeight: '600' },
    champion: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.lg,
      padding: spacing.lg,
      alignItems: 'center',
      marginBottom: spacing.md,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    championEmoji: { fontSize: 36 },
    championText: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: spacing.xs, textAlign: 'center' },
    match: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    matchReady: { borderColor: colors.primary },
    matchMine: { backgroundColor: colors.surfaceAlt },
    player: { color: colors.text, fontSize: 15 },
    playerMe: { fontWeight: '700' },
    winner: { color: colors.success, fontWeight: '700' },
    divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
    record: { color: colors.primary, fontWeight: '600', marginLeft: spacing.md },
    done: { color: colors.success, fontSize: 18, marginLeft: spacing.md },
    error: { color: colors.danger, padding: spacing.lg },
  });
}
