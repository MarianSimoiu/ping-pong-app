import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { withYou } from '@/components/PotsList';
import { formatMatchTime, isOverdue } from '@/lib/schedule';
import { winningScore, type TournamentNode } from '@/lib/tournaments';
import { radius, spacing, useTheme, type Colors } from '@/theme';

// A tournament's bracket drawn as a tree: a column per round, each match
// half-way between the two matches its players come from, with lines joining
// them, and the champion at the end. From the semifinals back it's wider than
// a phone, so it scrolls sideways, or zooms out to fit the screen's width
// (the choice is kept on the device).

const BOX_W = 160; // two rounds side by side fill a phone's width
const GAP = 22; // between rounds, where the lines run
const BOX_H = 78;
const ROW_GAP = 12; // between two first-round matches
const SLOT = BOX_H + ROW_GAP;
const AVATAR = 20;
const CHAMP_W = 112;
const LINE = 1.5;
const ZOOM_KEY = 'pingpong.bracket.zoomedOut';

export type BracketTreeProps = {
  nodes: TournamentNode[];
  totalRounds: number;
  champion: string | null;
  meId: string | null;
  now: number;
  nameOf: (id: string | null, fallback: string) => string;
  avatarOf: (id: string | null) => string | null;
  roundTitle: (round: number) => string;
  roundDays: (round: number) => string | null;
  canEditRound: (round: number) => boolean;
  onEditRound: (round: number) => void;
  // Whether the signed-in player can open a match (to record or manage it).
  canPress: (node: TournamentNode) => boolean;
  onPressMatch: (node: TournamentNode) => void;
  // The round to show first: the one being played.
  startRound: number;
};

export function BracketTree(props: BracketTreeProps) {
  const { nodes, totalRounds, champion, meId, nameOf, avatarOf, roundTitle, roundDays, startRound } = props;
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const scrollRef = useRef<ScrollView>(null);
  const scrolled = useRef(false);
  const [viewWidth, setViewWidth] = useState(0);
  // The tree's own height (column headers and matches), to size it zoomed out.
  const [treeHeight, setTreeHeight] = useState(0);
  const [zoomedOut, setZoomedOut] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(ZOOM_KEY)
      .then((stored) => stored === '1' && setZoomedOut(true))
      .catch(() => {});
  }, []);

  const rounds = Array.from({ length: totalRounds }, (_, i) => i + 1);
  const left = (round: number) => (round - 1) * (BOX_W + GAP);
  const champLeft = left(totalRounds) + BOX_W + GAP;
  const width = champLeft + CHAMP_W;
  const height = 2 ** (totalRounds - 1) * SLOT - ROW_GAP;
  // Each round's matches share the height equally; a match sits in the
  // middle of its share, so half-way between the two that lead to it.
  const centre = (round: number, slot: number) => (slot + 0.5) * SLOT * 2 ** (round - 1) - ROW_GAP / 2;

  // The lines: each pair of matches joined, and on to the match they lead to.
  const lines: React.ReactElement[] = [];
  for (const round of rounds.slice(0, -1)) {
    for (let k = 0; k < 2 ** (totalRounds - round - 1); k++) {
      const top = centre(round, 2 * k);
      const bottom = centre(round, 2 * k + 1);
      const x = left(round) + BOX_W;
      lines.push(
        <View
          key={`join-${round}-${k}`}
          style={[styles.join, { left: x, top: top - LINE / 2, width: GAP / 2, height: bottom - top + LINE }]}
        />,
        <View
          key={`on-${round}-${k}`}
          style={[styles.line, { left: x + GAP / 2, top: (top + bottom) / 2 - LINE / 2, width: GAP / 2 }]}
        />,
      );
    }
  }
  lines.push(
    <View key="to-champion" style={[styles.line, { left: left(totalRounds) + BOX_W, top: height / 2 - LINE / 2, width: GAP }]} />,
  );

  // The room inside the page's margins; wider than that, the tree scrolls, or
  // zoomed out it's scaled down to fit it.
  const room = viewWidth - 2 * spacing.lg;
  const overflows = viewWidth > 0 && width > room;
  const scale = overflows && zoomedOut ? room / width : 1;

  function toggleZoom() {
    const next = !zoomedOut;
    setZoomedOut(next);
    AsyncStorage.setItem(ZOOM_KEY, next ? '1' : '0').catch(() => {});
  }
  // Once it's redrawn: zoomed out, from the start; back to full size, on the
  // round being played again.
  const zoomChanged = useRef(false);
  useEffect(() => {
    if (!zoomChanged.current) {
      zoomChanged.current = true;
      return;
    }
    scrollRef.current?.scrollTo({ x: zoomedOut || startRound <= 1 ? 0 : left(startRound), animated: false });
  }, [zoomedOut]);

  return (
    <>
      {overflows && (
        <View style={styles.toolbar}>
          <Text style={styles.hint}>{zoomedOut ? 'The whole bracket' : 'Swipe sideways to see every round →'}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={zoomedOut ? 'Zoom in on the bracket' : 'Zoom out to fit the whole bracket'}
            onPress={toggleZoom}
            hitSlop={8}
            style={styles.zoomButton}
          >
            <Text style={styles.zoomText}>{zoomedOut ? '🔍 Zoom in' : '🔍 Zoom out'}</Text>
          </Pressable>
        </View>
      )}
      <ScrollView
        ref={scrollRef}
        horizontal
        scrollEnabled={scale === 1}
        style={styles.scroller}
        contentContainerStyle={styles.scrollContent}
        onLayout={(e) => setViewWidth(e.nativeEvent.layout.width)}
        onContentSizeChange={() => {
          // Open on the round being played (once: not on every refresh).
          if (scrolled.current) return;
          scrolled.current = true;
          if (startRound > 1 && scale === 1) scrollRef.current?.scrollTo({ x: left(startRound), animated: false });
        }}
      >
        {/* Zoomed out: the tree drawn smaller, in a box of its smaller size. */}
        <View style={scale < 1 ? { width: width * scale, height: treeHeight * scale, overflow: 'hidden' } : null}>
          <View
            onLayout={(e) => setTreeHeight(e.nativeEvent.layout.height)}
            style={scale < 1 ? { width, transform: [{ scale }], transformOrigin: 'top left' } : null}
          >
            <View style={styles.headers}>
              {rounds.map((round) => {
                const title = roundTitle(round);
                const days = roundDays(round);
                return (
                  <View key={round} style={[styles.header, { width: BOX_W, marginRight: GAP }]}>
                    <Text style={styles.headerTitle} numberOfLines={1}>
                      {title}
                    </Text>
                    <View style={styles.headerSub}>
                      {days && <Text style={styles.headerDays}>{days}</Text>}
                      {props.canEditRound(round) && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Change the days of the ${title.toLowerCase()}`}
                          onPress={() => props.onEditRound(round)}
                          hitSlop={8}
                        >
                          <Text style={styles.editLink}>Edit</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                );
              })}
              <View style={[styles.header, { width: CHAMP_W }]}>
                <Text style={styles.headerTitle}>Champion</Text>
              </View>
            </View>

            <View style={{ width, height }}>
              {lines}
              {nodes.map((node) => (
                <MatchBox
                  key={node.id}
                  node={node}
                  left={left(node.round)}
                  top={centre(node.round, node.slot) - BOX_H / 2}
                  {...props}
                  styles={styles}
                />
              ))}
              <View style={[styles.champ, { left: champLeft, top: height / 2 - BOX_H / 2 }]}>
                <Text style={styles.trophy}>🏆</Text>
                {champion ? (
                  <View style={styles.champRow}>
                    <Avatar uri={avatarOf(champion)} name={nameOf(champion, '?')} size={AVATAR} playerId={champion} />
                    <Text style={styles.champName} numberOfLines={1}>
                      {withYou(nameOf(champion, '?'), champion === meId)}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.champTbd}>?</Text>
                )}
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </>
  );
}

type Styles = ReturnType<typeof createStyles>;

function MatchBox({
  node,
  left,
  top,
  meId,
  now,
  nameOf,
  avatarOf,
  canPress,
  onPressMatch,
  styles,
}: BracketTreeProps & { node: TournamentNode; left: number; top: number; styles: Styles }) {
  const ready = node.status === 'ready';
  const bye = node.round === 1 && node.status === 'completed' && (!node.playerA || !node.playerB);
  const mine = !!meId && (node.playerA === meId || node.playerB === meId);
  const overdue = isOverdue(node, now);
  const score = winningScore(node);
  const time = ready && node.scheduledAt ? formatMatchTime(node.scheduledAt, now) : null;
  const pressable = canPress(node);
  const fallback = node.status === 'pending' ? 'TBD' : 'Bye';
  const nameA = nameOf(node.playerA, fallback);
  const nameB = nameOf(node.playerB, fallback);
  const winner = nameOf(node.winnerId, '');

  // Between the two players: the score once it's played, else when it's on.
  let middle: React.ReactNode = null;
  let said: string | null = null;
  if (score) {
    middle = <Text style={styles.midScore}>{score}</Text>;
    said = `${winner} won ${score}`;
  } else if (node.walkover) {
    middle = <Text style={styles.midMuted}>Walkover</Text>;
    said = `${winner} won on a walkover`;
  } else if (time) {
    middle = (
      <Text style={[styles.midTime, pressable && styles.midAction, overdue && styles.midOverdue]} numberOfLines={1}>
        {time}
        {pressable ? ' ›' : ''}
      </Text>
    );
    said = overdue ? `was due ${time}` : time;
  }

  return (
    <Pressable
      accessibilityRole={pressable ? 'button' : undefined}
      accessibilityLabel={[`${nameA} v ${nameB}`, said].filter(Boolean).join(', ')}
      disabled={!pressable}
      onPress={() => onPressMatch(node)}
      style={[
        styles.box,
        { left, top },
        ready && styles.boxReady,
        mine && styles.boxMine,
        bye && styles.boxBye,
      ]}
    >
      <Side
        id={node.playerA}
        name={nameA}
        avatarUrl={avatarOf(node.playerA)}
        isWinner={!!node.winnerId && node.winnerId === node.playerA}
        isMe={!!meId && node.playerA === meId}
        styles={styles}
      />
      <View style={styles.mid}>
        <View style={styles.midLine} />
        {middle}
        {middle && <View style={styles.midLine} />}
      </View>
      <Side
        id={node.playerB}
        name={nameB}
        avatarUrl={avatarOf(node.playerB)}
        isWinner={!!node.winnerId && node.winnerId === node.playerB}
        isMe={!!meId && node.playerB === meId}
        styles={styles}
      />
    </Pressable>
  );
}

// One player of a match: photo (with their tier ring) and name, or an empty
// circle while it's not known who plays.
function Side({
  id,
  name,
  avatarUrl,
  isWinner,
  isMe,
  styles,
}: {
  id: string | null;
  name: string;
  avatarUrl: string | null;
  isWinner: boolean;
  isMe: boolean;
  styles: Styles;
}) {
  return (
    <View style={styles.side}>
      {id ? <Avatar uri={avatarUrl} name={name} size={AVATAR} playerId={id} /> : <View style={styles.avatarEmpty} />}
      <Text style={[styles.name, isMe && styles.nameMe, isWinner && styles.nameWinner]} numberOfLines={1}>
        {withYou(name, isMe)}
      </Text>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      marginTop: -2,
      marginBottom: spacing.sm,
    },
    hint: { color: colors.textMuted, fontSize: 12, flexShrink: 1 },
    zoomButton: {
      borderWidth: 1,
      borderColor: colors.primary,
      borderRadius: 999,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 4,
    },
    zoomText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
    // Edge to edge, so the rounds scroll under the screen's sides.
    scroller: { marginHorizontal: -spacing.lg },
    scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    headers: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.sm },
    header: { gap: 2 },
    headerTitle: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    headerSub: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: spacing.sm, minHeight: 17 },
    headerDays: { color: colors.text, fontSize: 12, fontWeight: '600' },
    editLink: { color: colors.primary, fontSize: 12, fontWeight: '700' },
    // The lines: darker than the cards' borders, so the way through reads.
    join: {
      position: 'absolute',
      borderTopWidth: LINE,
      borderRightWidth: LINE,
      borderBottomWidth: LINE,
      borderColor: colors.textMuted,
      borderTopRightRadius: 6,
      borderBottomRightRadius: 6,
      opacity: 0.55,
    },
    line: { position: 'absolute', height: LINE, backgroundColor: colors.textMuted, opacity: 0.55 },
    box: {
      position: 'absolute',
      width: BOX_W,
      height: BOX_H,
      justifyContent: 'center',
      paddingHorizontal: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    boxReady: { borderColor: colors.primary },
    boxMine: { backgroundColor: colors.surfaceAlt },
    boxBye: { opacity: 0.6 },
    side: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 22 },
    avatarEmpty: {
      width: AVATAR,
      height: AVATAR,
      borderRadius: AVATAR / 2,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.border,
    },
    name: { color: colors.text, fontSize: 13, flexShrink: 1 },
    nameMe: { fontWeight: '700' },
    nameWinner: { color: colors.success, fontWeight: '700' },
    mid: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 20 },
    midLine: { flex: 1, height: 1, backgroundColor: colors.border },
    midScore: { color: colors.text, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
    midMuted: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
    midTime: { color: colors.textMuted, fontSize: 11, fontWeight: '600', flexShrink: 1 },
    midAction: { color: colors.primary },
    midOverdue: { color: colors.danger },
    champ: {
      position: 'absolute',
      width: CHAMP_W,
      height: BOX_H,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingHorizontal: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    trophy: { fontSize: 20, lineHeight: 24 },
    champRow: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
    champName: { color: colors.text, fontSize: 13, fontWeight: '800', flexShrink: 1 },
    champTbd: { color: colors.textMuted, fontSize: 15, fontWeight: '700' },
  });
}
