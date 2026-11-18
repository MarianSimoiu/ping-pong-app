import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BracketTree } from '@/components/BracketTree';
import { Countdown } from '@/components/Countdown';
import { DateTimeField } from '@/components/DateTimeField';
import { ManageMatchSheet, ProposeTimeSheet } from '@/components/MatchSheets';
import { PlayerName } from '@/components/PlayerLink';
import { PotRules, PotsList, withYou } from '@/components/PotsList';
import { inscription, Medal, MedalBadge, Sunburst, Trophy, TrophyBadge } from '@/components/TournamentArt';
import { useAuth } from '@/context/AuthContext';
import { useBadges } from '@/context/BadgesContext';
import { pickChampionLine } from '@/lib/commentary';
import { defaultKickoff, fromLocalInputValue, toLocalInputValue, useNow } from '@/lib/countdown';
import { formatKickoff } from '@/lib/format';
import { groupByPot } from '@/lib/pots';
import { confirmMatch } from '@/lib/matches';
import { confirmAction, showAlert } from '@/lib/platformAlert';
import { fetchIsAdmin, fetchMyProfile } from '@/lib/players';
import {
  clubDay,
  formatDayRange,
  formatMatchTime,
  isOverdue,
  pickableDays,
  proposalDays,
  slotMinutes,
} from '@/lib/schedule';
import {
  answerMatchTime,
  cancelTournament,
  fetchTournamentDetail,
  finalOf,
  isPastKickoff,
  isThirdPlace,
  MIN_TOURNAMENT_PLAYERS,
  registerForTournament,
  requestKickoff,
  rescheduleTournament,
  roundDaysShown,
  scoreLine,
  setRoundDates,
  sideAWon,
  startTournamentNow,
  thirdPlaces,
  withdrawFromTournament,
  type PendingResult,
  type TournamentDetail,
  type TournamentNode,
} from '@/lib/tournaments';
import type { TournamentsStackScreenProps } from '@/navigation/types';
import { radius, spacing, useTheme, type Colors } from '@/theme';

// As the server's notifications name them (_shared/rounds.ts): the last
// round's second match (`slot` 1) is the third-place match.
function roundLabel(round: number, totalRounds: number, slot = 0): string {
  if (isThirdPlace({ round, slot }, totalRounds)) return 'Third place';
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  if (fromEnd === 3) return 'Round of 16';
  if (fromEnd === 4) return 'Round of 32';
  return `Round ${round}`;
}

// Where the signed-in player stands in a drawn bracket. A semifinal lost
// leads to the third-place match (where there is one): 'third' is winning it.
type MyPath =
  | { kind: 'play'; node: TournamentNode; opponent: string }
  | { kind: 'wait'; node: TournamentNode; from: [string, string] | null }
  | { kind: 'out'; node: TournamentNode; by: string | null }
  | { kind: 'third' }
  | { kind: 'won' };

function myPath(nodes: TournamentNode[], meId: string, totalRounds: number): MyPath | null {
  const mine = nodes.filter((n) => n.playerA === meId || n.playerB === meId);
  if (mine.length === 0) return null;
  const other = (n: TournamentNode) => (n.playerA === meId ? n.playerB : n.playerA);
  const third = mine.find((n) => isThirdPlace(n, totalRounds));
  if (third?.status === 'completed') {
    return third.winnerId === meId ? { kind: 'third' } : { kind: 'out', node: third, by: other(third) };
  }
  const lost = mine.find((n) => n.status === 'completed' && n.winnerId && n.winnerId !== meId);
  if (lost && !third) return { kind: 'out', node: lost, by: other(lost) };
  const next = mine.filter((n) => n.status !== 'completed').sort((a, b) => a.round - b.round)[0];
  if (!next) return { kind: 'won' };
  const isA = next.playerA === meId;
  const opponent = isA ? next.playerB : next.playerA;
  if (opponent) return { kind: 'play', node: next, opponent };
  // Side A of a match is fed by slot 2s of the round before, side B by 2s + 1;
  // in the third-place match by the first and second semifinals' losers, so
  // the opponent comes from the other one.
  const feederSlot = next === third ? (isA ? 1 : 0) : next.slot * 2 + (isA ? 1 : 0);
  const feeder = nodes.find((n) => n.round === next.round - 1 && n.slot === feederSlot);
  return {
    kind: 'wait',
    node: next,
    from: feeder?.playerA && feeder.playerB ? [feeder.playerA, feeder.playerB] : null,
  };
}

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
  | 'confirmResult'
  | 'declineResult'
  | null;
type Sheet = { kind: 'propose' | 'manage'; nodeId: string } | null;

export function TournamentDetailScreen({ route, navigation }: TournamentsStackScreenProps<'TournamentDetail'>) {
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => createStyles(colors, scheme === 'dark'), [colors, scheme]);
  const { session } = useAuth();
  const { refresh: refreshBadges } = useBadges();
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
    detail?.tournament.status === 'completed' ? finalOf(detail.nodes, detail.totalRounds)?.winnerId ?? null : null;
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
  // "AUTUMN OPEN 2026" on its trophy and medals: the year it ended, or (before
  // that) the year of its kickoff.
  const lettering = inscription(tournament.name, tournament.endedAt ?? tournament.kickoffAt ?? tournament.createdAt);
  const count = participants.length;
  const meId = me?.id ?? null;
  const myEntry = meId ? participants.find((p) => p.playerId === meId) : undefined;
  const myRank = meId
    ? groupByPot(participants)
        .flatMap((g) => g.players)
        .find((p) => p.playerId === meId)?.rank ?? null
    : null;
  const nameOf = (id: string | null, fallback: string) => (id ? nameById[id] ?? 'Unknown' : fallback);
  const avatarById = new Map(participants.map((p) => [p.playerId, p.avatarUrl]));
  const avatarOf = (id: string | null) => (id ? avatarById.get(id) ?? null : null);
  const players =(n: number) => `${n} ${n === 1 ? 'player' : 'players'}`;

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
    // Anyone can register; with no rated match yet, a player counts as 1500.
    const unrated = !!me && me.matchesPlayed === 0;
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
            {unrated ? ' Until you play a rated match, you count as 1500.' : ''} You'll get a notification with your
            first opponent.
          </Text>
          {button('Withdraw', withdraw, 'withdraw', 'secondary')}
        </View>
      );
    } else if (me) {
      status = (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Registration is open</Text>
          <Text style={styles.cardText}>
            Join before kickoff and see which pot your rating puts you in.
            {unrated ? " No matches yet? You're in too: you count as 1500." : ''}
          </Text>
          {button('Register', () => run('register', () => registerForTournament(tournamentId)), 'register')}
        </View>
      );
    }

    return (
      <>
        {renderPrizes()}
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
    const path = myPath(nodes, meId, totalRounds);
    if (!path || path.kind === 'won') return null;
    if (path.kind === 'third') {
      return (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🥉 Third place</Text>
          <Text style={styles.cardText}>You won the third-place match, and the bronze medal.</Text>
        </View>
      );
    }
    if (path.kind === 'out') {
      const by = path.by && (
        <PlayerName playerId={path.by} name={nameOf(path.by, '')} style={styles.strong} />
      );
      return (
        <View style={styles.card}>
          {isThirdPlace(path.node, totalRounds) ? (
            <>
              <Text style={styles.cardTitle}>Fourth place</Text>
              <Text style={styles.cardText}>Lost the third-place match{by && <> to {by}</>}.</Text>
            </>
          ) : (
            <>
              <Text style={styles.cardTitle}>You're out</Text>
              <Text style={styles.cardText}>
                Lost{by && <> to {by}</>} in the {roundLabel(path.node.round, totalRounds).toLowerCase()}.
              </Text>
            </>
          )}
        </View>
      );
    }
    const round = roundLabel(path.node.round, totalRounds, path.node.slot);
    if (path.kind === 'play') {
      const node = path.node;
      const opponent = nameOf(path.opponent, '');
      // A result one of you recorded, waiting for the other (0028): it's been
      // played, so no times or recording until it's confirmed or declined.
      const result = node.pending;
      const ready = node.status === 'ready' && !result;
      const overdue = !result && isOverdue(node, clock);
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
          <Text style={styles.versus}>
            vs <PlayerName playerId={path.opponent} name={opponent} />
          </Text>
          {result && renderResult(node, result, path.opponent, opponent)}
          {ready && node.scheduledAt && (
            <Text style={[styles.when, overdue && styles.whenOverdue]}>🗓 {formatMatchTime(node.scheduledAt, clock)}</Text>
          )}
          {ready && node.scheduledAt && !overdue && (
            <Text style={styles.flexibleNote}>
              Flexible: if you're both ready earlier, go to the table and play if it's free.
            </Text>
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
                <PlayerName playerId={path.opponent} name={opponent} style={styles.strong} /> asks to move it to{' '}
                <Text style={styles.strong}>{formatMatchTime(node.proposedAt!, clock)}</Text>.
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
                Waiting for <PlayerName playerId={path.opponent} name={opponent} style={styles.strong} /> to accept.
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
    const dates = roundDaysShown(roundDates(path.node.round), nodes, path.node.round);
    return (
      <View style={styles.card}>
        <Text style={styles.cardKicker}>
          Up next · {round}
          {dates ? ` · ${formatDayRange(dates.startsOn, dates.endsOn)}` : ''}
        </Text>
        <Text style={styles.cardText}>
          {path.from ? (
            <>
              You play the {isThirdPlace(path.node, totalRounds) ? 'loser' : 'winner'} of{' '}
              <PlayerName playerId={path.from[0]} name={nameOf(path.from[0], '')} style={styles.strong} /> v{' '}
              <PlayerName playerId={path.from[1]} name={nameOf(path.from[1], '')} style={styles.strong} />
              {isThirdPlace(path.node, totalRounds) ? ', for third place and the bronze medal.' : '.'}
            </>
          ) : (
            'Your opponent is decided by an earlier match.'
          )}{' '}
          Your match gets its time as soon as they've played.
        </Text>
      </View>
    );
  }

  // A result waiting to be confirmed, on the player's own match card: theirs
  // to confirm or decline, or waiting for their opponent.
  function renderResult(node: TournamentNode, result: PendingResult, opponentId: string, opponent: string) {
    const iAmA = node.playerA === meId;
    const mine = result.games.map((g) => (iAmA ? [g.a, g.b] : [g.b, g.a]));
    const myGames = mine.filter(([x, y]) => x > y).length;
    const iWon = myGames > mine.length - myGames;
    // Your side first: games won, or a one-game match's points.
    const score = mine.length === 1 ? `${mine[0][0]}–${mine[0][1]}` : `${myGames}–${mine.length - myGames}`;
    // Each game's score kept on one line (word joiners around the dash).
    const games = mine.length > 1 ? ` (${mine.map(([x, y]) => `${x}\u2060–\u2060${y}`).join(', ')})` : '';
    const byMe = result.by === meId;
    const who = <PlayerName playerId={opponentId} name={opponent} style={styles.strong} />;

    async function answer(action: 'confirm' | 'decline') {
      if (
        action === 'decline' &&
        !(await confirmAction(
          'Decline this result?',
          `It won't count, and the match is still to be recorded. Agree on the score with ${opponent} and record it again, or ask the organizer.`,
          'Decline',
        ))
      ) {
        return;
      }
      run(action === 'confirm' ? 'confirmResult' : 'declineResult', async () => {
        const answered = await confirmMatch(result.matchId, action);
        if (action === 'confirm') {
          refreshBadges(); // the result can move tiers
          if (answered.you) {
            const d = answered.you.delta;
            showAlert(
              'Result confirmed',
              `You ${iWon ? 'won' : 'lost'} ${score}. Rating ${d >= 0 ? '+' : ''}${d}, now ${answered.you.rating}.`,
            );
          }
        }
      });
    }

    return (
      <View style={styles.proposal}>
        <Text style={styles.proposalText}>
          {byMe ? 'You recorded it: ' : <>{who} recorded it: </>}
          you {iWon ? 'won' : 'lost'} <Text style={styles.strong}>{score}</Text>
          {games}.
        </Text>
        <Text style={styles.cardText}>
          {byMe ? (
            <>
              Waiting for {who} to confirm it. It counts, and the winner goes on, once they do.
            </>
          ) : (
            'It counts, and the winner goes on, once you confirm it.'
          )}
        </Text>
        {!byMe && (
          <View style={styles.buttonRow}>
            <View style={{ flex: 1 }}>{button('Confirm', () => answer('confirm'), 'confirmResult')}</View>
            <View style={{ flex: 1 }}>{button('Decline', () => answer('decline'), 'declineResult', 'danger')}</View>
          </View>
        )}
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
                {roundLabel(n.round, totalRounds, n.slot)} ·{' '}
                {n.pending
                  ? `${nameOf(n.pending.by, '?')} recorded ${scoreLine(n.pending.games, sideAWon(n.pending.games))}, not confirmed yet`
                  : `due ${formatMatchTime(n.scheduledAt!, clock)}`}
              </Text>
            </View>
            <Text style={styles.record}>Decide ›</Text>
          </Pressable>
        ))}
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

  // Until it's over: what's up for grabs, lettered as the real ones will be
  // (the champion's trophy, silver for the runner-up, bronze for third place),
  // set out like a podium.
  function renderPrizes() {
    return (
      <View style={[styles.hero2, styles.prizes]}>
        <View style={styles.prizesBurst} pointerEvents="none">
          <Sunburst size={340} color={scheme === 'dark' ? '#3A2A1C' : '#FCE6C3'} />
        </View>
        <Text style={[styles.heroKicker, styles.prizesKicker]}>Up for grabs</Text>
        <View style={styles.prizeRow}>
          <View style={styles.prizeSide}>
            <View style={styles.prizeArt}>
              <Medal place={2} size={62} text={lettering} label={`The ${tournament.name} silver medal`} />
            </View>
            <Text style={styles.prizeLabel}>Runner-up</Text>
          </View>
          <View style={styles.prizeMain}>
            <View style={styles.prizeArt}>
              <Trophy size={124} text={lettering} label={`The ${tournament.name} trophy`} />
            </View>
            <Text style={[styles.prizeLabel, styles.prizeLabelMain]}>Champion</Text>
          </View>
          <View style={styles.prizeSide}>
            <View style={styles.prizeArt}>
              <Medal place={3} size={62} text={lettering} label={`The ${tournament.name} bronze medal`} />
            </View>
            <Text style={styles.prizeLabel}>
              {nodes.some((n) => isThirdPlace(n, totalRounds)) ? 'Third place' : 'Both semifinal losers'}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // Over: the champion with the trophy, then the podium (the runner-up's
  // silver medal, and bronze for the third-place match's winner, or both
  // semifinal losers before there was one, as the server's tournament_podium
  // has it).
  function renderPodium() {
    const final = finalOf(nodes, totalRounds);
    if (!final?.winnerId) return null;
    const runnerUp = final.playerA === final.winnerId ? final.playerB : final.playerA;
    const thirds = thirdPlaces(nodes, totalRounds);
    const places: { place: 1 | 2 | 3; label: string; ids: string[] }[] = [
      { place: 1, label: 'Champion', ids: [final.winnerId] },
      ...(runnerUp ? [{ place: 2 as const, label: 'Runner-up', ids: [runnerUp] }] : []),
      ...(thirds.length > 0 ? [{ place: 3 as const, label: 'Third place', ids: thirds }] : []),
    ];
    // Each name opens its player's profile.
    const names = (ids: string[]) =>
      ids.map((id, i) => (
        <React.Fragment key={id}>
          {i > 0 && ' · '}
          <PlayerName playerId={id} name={nameOf(id, '?')}>
            {withYou(nameOf(id, '?'), id === meId)}
          </PlayerName>
        </React.Fragment>
      ));
    return (
      <>
        <View style={styles.hero2}>
          <View style={styles.heroBurst} pointerEvents="none">
            <Sunburst size={400} color={scheme === 'dark' ? '#3A2A1C' : '#FCE6C3'} />
          </View>
          <Trophy size={170} text={lettering} label={`The ${tournament.name} trophy`} />
          <Text style={styles.heroKicker}>Champion</Text>
          <Text style={styles.heroName}>{names([final.winnerId])}</Text>
          {championLine && <Text style={styles.heroLine}>{championLine}</Text>}
        </View>
        <Text style={styles.sectionLabel}>Podium</Text>
        <View style={styles.podium}>
          {places.map((p, i) => (
            <View key={p.place} style={[styles.podiumRow, i > 0 && styles.podiumDivider]}>
              <View style={styles.podiumArt}>
                {p.place === 1 ? <TrophyBadge size={30} /> : <MedalBadge place={p.place} size={28} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.podiumPlace}>{p.label}</Text>
                <Text style={styles.podiumName}>{names(p.ids)}</Text>
              </View>
            </View>
          ))}
        </View>
      </>
    );
  }

  function renderBracket() {
    // The rounds being played: the tree opens on the first of them.
    const playing = tournament.status === 'active' ? nodes.filter((n) => n.status === 'ready').map((n) => n.round) : [];
    const hasPots = participants.some((p) => p.pot !== null);
    return (
      <>
        {tournament.status === 'completed' ? renderPodium() : renderPrizes()}
        {tournament.status === 'active' && renderMyPath()}
        {actionError && !editingRound && <Text style={styles.actionError}>{actionError}</Text>}
        {renderOverdue()}
        {tournament.status === 'active' && roundDays.length > 0 && (
          <Text style={styles.scheduleHint}>
            🗓 One table, 11:00 to 18:00 Bucharest time, {slotMinutes(tournament.bestOf)} minutes a match. Round 1
            starts the weekday after the draw; after that, as soon as a match's two players are known it gets the
            first free time on the table, the same day if there's room. The times are flexible: if you're both ready
            earlier, play when the table's free; or agree another time, up to a day later.
          </Text>
        )}

        <Text style={styles.sectionLabel}>Bracket</Text>
        {editingRound && renderRoundEditor(editingRound.round)}
        {roundNotice && (
          <Text style={styles.notice}>
            {roundLabel(roundNotice.round, totalRounds)}: {roundNotice.text}
          </Text>
        )}
        <BracketTree
          nodes={nodes}
          totalRounds={totalRounds}
          bestOf={tournament.bestOf}
          champion={champion}
          meId={meId}
          now={clock}
          nameOf={nameOf}
          avatarOf={avatarOf}
          roundTitle={(round) => roundLabel(round, totalRounds)}
          roundDays={(round) => {
            const dates = roundDaysShown(roundDates(round), nodes, round);
            return dates ? formatDayRange(dates.startsOn, dates.endsOn) : null;
          }}
          canEditRound={(round) =>
            isAdmin && tournament.status === 'active' && !!roundDates(round) && editingRound?.round !== round
          }
          onEditRound={openRoundDates}
          canPress={(node) => canManage(node) || (node.status === 'ready' && !node.pending && canRecord(node))}
          onPressMatch={onMatchPress}
          startRound={playing.length > 0 ? Math.min(...playing) : 1}
        />

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
          roundName={roundLabel(sheetNode.round, totalRounds, sheetNode.slot)}
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

function createStyles(colors: Colors, dark = false) {
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
    flexibleNote: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: 2 },
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
    dateField: { flex: 1, gap: spacing.xs },
    fieldLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
    notice: { color: colors.success, fontSize: 13, fontWeight: '600', marginBottom: spacing.sm },
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
    sectionRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    sectionLabelInRow: { marginTop: 0, marginBottom: 0 },
    live: { color: colors.success, fontSize: 12, fontWeight: '600' },
    hero2: {
      backgroundColor: dark ? '#2A2019' : '#FFF8EE',
      borderColor: dark ? '#6B4A2E' : '#E7B98C',
      borderWidth: 1,
      borderRadius: radius.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      overflow: 'hidden',
      marginBottom: spacing.xs,
    },
    heroBurst: { position: 'absolute', top: -96, left: '50%', marginLeft: -200 },
    heroKicker: {
      color: dark ? colors.textMuted : '#765F61',
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: spacing.xs,
    },
    heroName: { color: colors.text, fontSize: 28, fontWeight: '800', textAlign: 'center' },
    heroLine: { color: dark ? colors.textMuted : '#765F61', fontSize: 14, textAlign: 'center', marginTop: 2 },
    prizes: { marginBottom: spacing.md },
    // Centered on the trophy: kicker (about 28 px from the top) plus half the trophy's 155.
    prizesBurst: { position: 'absolute', top: -64, left: '50%', marginLeft: -170 },
    prizesKicker: { marginTop: 0, marginBottom: spacing.xs },
    prizeRow: { flexDirection: 'row', alignItems: 'flex-start', alignSelf: 'stretch', justifyContent: 'center' },
    prizeSide: { flex: 1, alignItems: 'center' },
    prizeMain: { width: 136, alignItems: 'center' },
    // As tall as the trophy, so the medals stand on the same line as its base.
    prizeArt: { height: 155, justifyContent: 'flex-end', alignItems: 'center' },
    prizeLabel: {
      color: dark ? colors.textMuted : '#765F61',
      fontSize: 12,
      fontWeight: '700',
      textAlign: 'center',
      marginTop: spacing.xs,
    },
    prizeLabelMain: { color: colors.text },
    podium: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
    },
    podiumRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md - 2, paddingVertical: 10 },
    podiumDivider: { borderTopWidth: 1, borderTopColor: colors.border },
    podiumArt: { width: 36, alignItems: 'center' },
    podiumPlace: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
    podiumName: { color: colors.text, fontSize: 16, fontWeight: '700' },
    record: { color: colors.primary, fontWeight: '600', marginLeft: spacing.md },
    error: { color: colors.danger, padding: spacing.lg },
  });
}
