import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Countdown } from '@/components/Countdown';
import { DateTimeField } from '@/components/DateTimeField';
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
  cancelTournament,
  fetchTournamentDetail,
  isPastKickoff,
  MIN_TOURNAMENT_PLAYERS,
  registerForTournament,
  requestKickoff,
  rescheduleTournament,
  startTournamentNow,
  withdrawFromTournament,
  type TournamentDetail,
  type TournamentNode,
} from '@/lib/tournaments';
import type { TournamentsStackScreenProps } from '@/navigation/types';
import { radius, spacing, useTheme, type Colors } from '@/theme';

function roundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
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
type Busy = 'register' | 'withdraw' | 'start' | 'reschedule' | 'cancel' | null;

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

  const { tournament, participants, nodes, nameById, totalRounds } = detail;
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

  // The players of a match and its organizer can record it (as the server allows).
  const canRecord = (node: TournamentNode) =>
    !!meId && (node.playerA === meId || node.playerB === meId || tournament.createdBy === meId);

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
      return (
        <View style={[styles.card, styles.cardHighlight]}>
          <Text style={styles.cardKicker}>Your match · {round}</Text>
          <Text style={styles.versus}>vs {nameOf(path.opponent, '')}</Text>
          {path.node.status === 'ready' && button('Record result', () => onNodePress(path.node), null)}
        </View>
      );
    }
    return (
      <View style={styles.card}>
        <Text style={styles.cardKicker}>Up next · {round}</Text>
        <Text style={styles.cardText}>
          {path.winnerOf
            ? `You play the winner of ${nameOf(path.winnerOf[0], '')} v ${nameOf(path.winnerOf[1], '')}.`
            : 'Your opponent is decided by an earlier match.'}
        </Text>
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

        {rounds.map((round) => {
          const shown = nodes.filter((n) => n.round === round && !isBye(n));
          return (
            <View key={round}>
              <Text style={styles.sectionLabel}>{roundLabel(round, totalRounds)}</Text>
              {round === 1 && byes > 0 && (
                <Text style={styles.sectionHint}>
                  {byes === 1 ? '1 player has' : `${byes} players have`} a bye into round 2.
                </Text>
              )}
              {shown.map((node) => {
                const isReady = node.status === 'ready';
                const mine = !!meId && (node.playerA === meId || node.playerB === meId);
                const recordable = isReady && canRecord(node);
                return (
                  <Pressable
                    key={node.id}
                    style={[styles.match, isReady && styles.matchReady, mine && styles.matchMine]}
                    onPress={() => onNodePress(node)}
                    disabled={!recordable}
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
                    </View>
                    {recordable && <Text style={styles.record}>Record ›</Text>}
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
