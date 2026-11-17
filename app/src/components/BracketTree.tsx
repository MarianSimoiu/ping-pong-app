import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { PlayerLink } from '@/components/PlayerLink';
import { withYou } from '@/components/PotsList';
import { formatMatchTime, isOverdue } from '@/lib/schedule';
import { scoreLine, sideAWon, winningScore, type TournamentNode } from '@/lib/tournaments';
import { radius, spacing, useTheme, type Colors } from '@/theme';

// A tournament's bracket drawn as a tree: a column per round, each match
// half-way between the two matches its players come from, with lines joining
// them, and the champion at the end. From the semifinals back it's wider than
// a phone, so it scrolls sideways, and it zooms: pinch it (or Ctrl + scroll on
// a computer, or use the button) anywhere from the whole bracket across the
// screen up to twice its size. Whether it opens on the whole bracket is kept
// on the device.

const BOX_W = 160; // two rounds side by side fill a phone's width (best of 1 or 3)
const SET_W = 18; // one game's points on a player's row: a 15 px cell and a 3 px gap
const GAP = 22; // between rounds, where the lines run
const BOX_H = 78;
const ROW_GAP = 12; // between two first-round matches
const SLOT = BOX_H + ROW_GAP;
const AVATAR = 20;
const CHAMP_W = 112;
const LINE = 1.5;
const ZOOM_KEY = 'pingpong.bracket.zoomedOut'; // '1': open on the whole bracket
const MAX_ZOOM = 2; // twice the usual size, for the small print
const SNAP = 0.04; // a pinch ending this near the whole bracket, or the usual size, settles there
const ZOOM_MS = 200; // the button's zoom, animated

// Wide enough for a whole match's games beside the names: the usual width up
// to best of 3, then one game's cell more for each game past three.
const boxWidth = (bestOf: number) => BOX_W + Math.max(0, bestOf - 3) * SET_W;

// How big the tree is drawn: a scale (1 is its usual size), or 'fit', the
// whole of it across the screen.
type Zoom = number | 'fit';
// A point of the tree (in its own units, before zooming) and the point of the
// screen it's held at while zooming.
type Anchor = { x: number; y: number; screenX: number; screenY: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export type BracketTreeProps = {
  nodes: TournamentNode[];
  totalRounds: number;
  bestOf: number;
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
  const boxRef = useRef<View>(null);
  const treeRef = useRef<View>(null);
  const scrolled = useRef(false);
  const [viewWidth, setViewWidth] = useState(0);
  // The tree's own height (column headers and matches), to size it zoomed.
  const [treeHeight, setTreeHeight] = useState(0);
  const [zoom, setZoom] = useState<Zoom>(1);
  useEffect(() => {
    AsyncStorage.getItem(ZOOM_KEY)
      .then((stored) => stored === '1' && setZoom('fit'))
      .catch(() => {});
  }, []);
  // A phone or tablet: the hints speak of pinching.
  const [touch] = useState(
    () => Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0,
  );

  const rounds = Array.from({ length: totalRounds }, (_, i) => i + 1);
  const boxW = boxWidth(props.bestOf);
  const left = (round: number) => (round - 1) * (boxW + GAP);
  const champLeft = left(totalRounds) + boxW + GAP;
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
      const x = left(round) + boxW;
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
    <View key="to-champion" style={[styles.line, { left: left(totalRounds) + boxW, top: height / 2 - LINE / 2, width: GAP }]} />,
  );

  // The room inside the page's margins: wider than that, the tree scrolls
  // sideways; 'fit' scales it down to just that.
  const room = viewWidth - 2 * spacing.lg;
  const fit = viewWidth > 0 && room > 0 && width > room ? room / width : 1;
  const z = zoom === 'fit' ? fit : clamp(zoom, fit, MAX_ZOOM);
  const whole = z <= fit + 0.001;

  const zoomTo = usePinchZoom({
    scrollRef,
    boxRef,
    treeRef,
    width,
    treeHeight,
    fit,
    z,
    onSettle: (next) => {
      setZoom(next);
      if (fit < 1) AsyncStorage.setItem(ZOOM_KEY, next === 'fit' ? '1' : '0').catch(() => {});
    },
  });
  // The button: back to the whole bracket, or from it to the usual size.
  const button = !whole
    ? { text: '🔍 Zoom out', label: 'Zoom out to fit the whole bracket', to: 'fit' as Zoom }
    : fit < 1
      ? { text: '🔍 Zoom in', label: 'Zoom in on the bracket', to: 1 }
      : null;
  const hint = whole
    ? touch
      ? 'The whole bracket · pinch to zoom in'
      : 'The whole bracket'
    : touch
      ? 'Pinch to zoom, swipe to move'
      : 'Swipe sideways to see every round →';

  return (
    <>
      {(fit < 1 || z > 1) && (
        <View style={styles.toolbar}>
          <Text style={styles.hint}>{hint}</Text>
          {button && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={button.label}
              onPress={() => zoomTo(button.to)}
              hitSlop={8}
              style={styles.zoomButton}
            >
              <Text style={styles.zoomText}>{button.text}</Text>
            </Pressable>
          )}
        </View>
      )}
      <ScrollView
        ref={scrollRef}
        horizontal
        style={styles.scroller}
        contentContainerStyle={styles.scrollContent}
        onLayout={(e) => setViewWidth(e.nativeEvent.layout.width)}
        onContentSizeChange={() => {
          // Open on the round being played (once: not on every refresh).
          if (scrolled.current) return;
          scrolled.current = true;
          if (startRound > 1 && zoom !== 'fit') {
            scrollRef.current?.scrollTo({ x: left(startRound) * z, animated: false });
          }
        }}
      >
        {/* The tree drawn at its zoom, in a box of its zoomed size. */}
        <View
          ref={boxRef}
          style={{ width: width * z, height: treeHeight > 0 ? treeHeight * z : undefined, overflow: 'hidden' }}
        >
          <View
            ref={treeRef}
            onLayout={(e) => setTreeHeight(e.nativeEvent.layout.height)}
            style={{ width, transform: [{ scale: z }], transformOrigin: 'top left' }}
          >
            <View style={styles.headers}>
              {rounds.map((round) => {
                const title = roundTitle(round);
                const days = roundDays(round);
                return (
                  <View key={round} style={[styles.header, { width: boxW, marginRight: GAP }]}>
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
                  width={boxW}
                  top={centre(node.round, node.slot) - BOX_H / 2}
                  {...props}
                  styles={styles}
                />
              ))}
              <View style={[styles.champ, { left: champLeft, top: height / 2 - BOX_H / 2 }]}>
                <Text style={styles.trophy}>🏆</Text>
                {champion ? (
                  <PlayerLink playerId={champion} name={nameOf(champion, '?')} style={styles.champRow}>
                    <Avatar uri={avatarOf(champion)} name={nameOf(champion, '?')} size={AVATAR} playerId={champion} />
                    <Text style={styles.champName} numberOfLines={1}>
                      {withYou(nameOf(champion, '?'), champion === meId)}
                    </Text>
                  </PlayerLink>
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

// The page's pieces a zoom moves: the sideways scroller, the zoom box and the
// tree in it, and the page's own scroller around them.
type ZoomParts = { scroller: HTMLElement; box: HTMLElement; tree: HTMLElement; page: HTMLElement | null };

// Zooming the tree on the web. Two fingers pinch it about the point between
// them and carry it as they move; Ctrl + scroll (a laptop trackpad's pinch)
// and Safari's trackpad pinch zoom it about the pointer. While a gesture
// lasts the zoom is drawn straight onto the page, without re-rendering, and
// the point being zoomed stays under the fingers (the tree scrolls sideways,
// the page up or down); when it ends it settles into the component's state,
// on the whole bracket or the usual size when it's close to either. The
// browser's own pinch, which zoomed the whole app, stays off the tree.
// Returns the button's zoom: animated, about the middle of what's on screen.
function usePinchZoom({
  scrollRef,
  boxRef,
  treeRef,
  width,
  treeHeight,
  fit,
  z,
  onSettle,
}: {
  scrollRef: React.RefObject<ScrollView>;
  boxRef: React.RefObject<View>;
  treeRef: React.RefObject<View>;
  width: number;
  treeHeight: number;
  fit: number;
  z: number;
  onSettle: (zoom: Zoom) => void;
}): (target: Zoom) => void {
  const latest = useRef({ width, treeHeight, fit, onSettle });
  latest.current = { width, treeHeight, fit, onSettle };
  // The zoom on screen: the state's, or a gesture's while it lasts.
  const shown = useRef(z);
  const busy = useRef(false);
  const frame = useRef(0);
  // A finished gesture's anchor, put back once its zoom has been re-rendered:
  // the hint above the tree may have changed (and with it the tree's place).
  const settling = useRef<{ p: ZoomParts; anchor: Anchor } | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useLayoutEffect(() => {
    if (!busy.current) shown.current = z;
    const s = settling.current;
    settling.current = null;
    if (s && !busy.current) draw(s.p, shown.current, s.anchor);
  });

  function parts(): ZoomParts | null {
    if (Platform.OS !== 'web') return null;
    const scroller = (scrollRef.current?.getScrollableNode() ?? null) as HTMLElement | null;
    const box = boxRef.current as unknown as HTMLElement | null;
    const tree = treeRef.current as unknown as HTMLElement | null;
    if (!scroller || !box || !tree) return null;
    let page: HTMLElement | null = null;
    for (let el = scroller.parentElement; el && !page; el = el.parentElement) {
      const { overflowY } = getComputedStyle(el);
      if (overflowY === 'auto' || overflowY === 'scroll') page = el;
    }
    return { scroller, box, tree, page };
  }
  // Draws the tree at `next`, then scrolls the anchor's point of the tree back
  // to its point of the screen.
  function draw(p: ZoomParts, next: number, anchor: Anchor | null) {
    const { width, treeHeight } = latest.current;
    p.box.style.width = `${width * next}px`;
    if (treeHeight > 0) p.box.style.height = `${treeHeight * next}px`;
    p.tree.style.transform = `scale(${next})`;
    shown.current = next;
    if (!anchor) return;
    const r = p.box.getBoundingClientRect();
    p.scroller.scrollLeft += r.left + anchor.x * next - anchor.screenX;
    const dy = r.top + anchor.y * next - anchor.screenY;
    if (p.page) p.page.scrollTop += dy;
    else window.scrollBy(0, dy);
  }
  // The point of the tree at a point of the screen.
  function anchorAt(p: ZoomParts, screenX: number, screenY: number): Anchor {
    const r = p.box.getBoundingClientRect();
    return { x: (screenX - r.left) / shown.current, y: (screenY - r.top) / shown.current, screenX, screenY };
  }
  function begin() {
    cancelAnimationFrame(frame.current);
    busy.current = true;
  }
  // Hands a finished zoom to the state, always re-rendering so the anchor is
  // put back straight after (and never later, on some unrelated render).
  function commit(p: ZoomParts, next: Zoom, anchor: Anchor | null) {
    busy.current = false;
    settling.current = anchor ? { p, anchor } : null;
    latest.current.onSettle(next);
    rerender();
  }
  // A gesture's end: close to the whole bracket or the usual size, it settles there.
  function settle(p: ZoomParts, anchor: Anchor | null) {
    const { fit } = latest.current;
    const now = shown.current;
    const next: Zoom = Math.abs(now - fit) <= fit * SNAP ? 'fit' : Math.abs(now - 1) <= SNAP ? 1 : now;
    const value = next === 'fit' ? fit : next;
    if (value !== now) draw(p, value, anchor);
    commit(p, next, anchor);
  }

  useEffect(() => {
    const first = parts();
    if (!first) return;
    const { scroller } = first;
    // A finger on the tree scrolls it, or the page; the browser doesn't zoom.
    scroller.style.touchAction = 'pan-x pan-y';

    let pinch: { p: ZoomParts; spread: number; z0: number; anchor: Anchor } | null = null;
    let pinchEnded = 0;
    let wheel: { p: ZoomParts; timer: ReturnType<typeof setTimeout> } | null = null;
    let safari: { p: ZoomParts; z0: number; anchor: Anchor } | null = null;
    const spreadOf = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const midX = (t: TouchList) => (t[0].clientX + t[1].clientX) / 2;
    const midY = (t: TouchList) => (t[0].clientY + t[1].clientY) / 2;

    function startPinch(t: TouchList) {
      const p = parts();
      if (!p) return;
      begin();
      safari = null;
      pinch = { p, spread: Math.max(spreadOf(t), 1), z0: shown.current, anchor: anchorAt(p, midX(t), midY(t)) };
    }
    function endPinch() {
      if (!pinch) return;
      const { p, anchor } = pinch;
      pinch = null;
      pinchEnded = Date.now();
      settle(p, anchor);
    }
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) startPinch(e.touches);
      else endPinch();
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      if (!pinch) startPinch(e.touches);
      if (!pinch) return;
      if (e.cancelable) e.preventDefault();
      pinch.anchor = { ...pinch.anchor, screenX: midX(e.touches), screenY: midY(e.touches) };
      const next = clamp((pinch.z0 * spreadOf(e.touches)) / pinch.spread, latest.current.fit, MAX_ZOOM);
      draw(pinch.p, next, pinch.anchor);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) endPinch();
    };
    // Lifting the fingers of a pinch isn't a tap on whatever is under them.
    const onClick = (e: MouseEvent) => {
      if (Date.now() - pinchEnded < 400) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // Ctrl + scroll: a laptop trackpad's pinch, or a mouse wheel with Ctrl held.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const p = wheel?.p ?? parts();
      if (!p) return;
      if (wheel) clearTimeout(wheel.timer);
      else begin();
      const anchor = anchorAt(p, e.clientX, e.clientY);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1; // lines, pages
      const step = clamp(-e.deltaY * unit, -25, 25) / 100;
      draw(p, clamp(shown.current * Math.exp(step), latest.current.fit, MAX_ZOOM), anchor);
      const timer = setTimeout(() => {
        wheel = null;
        settle(p, anchor);
      }, 250);
      wheel = { p, timer };
    };
    // Safari's pinch events: a Mac trackpad's pinch. On an iPhone or iPad the
    // touches above zoom the tree; these only keep Safari from zooming the page.
    type Gesture = Event & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      if (pinch) return;
      const p = parts();
      if (!p) return;
      const g = e as Gesture;
      begin();
      safari = { p, z0: shown.current, anchor: anchorAt(p, g.clientX, g.clientY) };
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (pinch || !safari) return;
      const g = e as Gesture;
      safari.anchor = { ...safari.anchor, screenX: g.clientX, screenY: g.clientY };
      draw(safari.p, clamp(safari.z0 * g.scale, latest.current.fit, MAX_ZOOM), safari.anchor);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      if (!safari) return;
      const { p, anchor } = safari;
      safari = null;
      settle(p, anchor);
    };

    const active = { passive: false };
    scroller.addEventListener('touchstart', onTouchStart, { passive: true });
    scroller.addEventListener('touchmove', onTouchMove, active);
    scroller.addEventListener('touchend', onTouchEnd);
    scroller.addEventListener('touchcancel', onTouchEnd);
    scroller.addEventListener('click', onClick, true);
    scroller.addEventListener('wheel', onWheel, active);
    scroller.addEventListener('gesturestart', onGestureStart, active);
    scroller.addEventListener('gesturechange', onGestureChange, active);
    scroller.addEventListener('gestureend', onGestureEnd, active);
    return () => {
      scroller.removeEventListener('touchstart', onTouchStart);
      scroller.removeEventListener('touchmove', onTouchMove);
      scroller.removeEventListener('touchend', onTouchEnd);
      scroller.removeEventListener('touchcancel', onTouchEnd);
      scroller.removeEventListener('click', onClick, true);
      scroller.removeEventListener('wheel', onWheel);
      scroller.removeEventListener('gesturestart', onGestureStart);
      scroller.removeEventListener('gesturechange', onGestureChange);
      scroller.removeEventListener('gestureend', onGestureEnd);
      if (wheel) clearTimeout(wheel.timer);
      cancelAnimationFrame(frame.current);
    };
  }, []);

  return (target: Zoom) => {
    const p = parts();
    const { fit, onSettle } = latest.current;
    if (!p) {
      onSettle(target);
      return;
    }
    // About the middle of the part of the tree that's on screen.
    const r = p.box.getBoundingClientRect();
    const side = p.scroller.getBoundingClientRect();
    const view = p.page ? p.page.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const top = Math.max(r.top, view.top);
    const bottom = Math.min(r.bottom, view.bottom);
    const anchor = anchorAt(
      p,
      (Math.max(r.left, side.left) + Math.min(r.right, side.right)) / 2,
      top < bottom ? (top + bottom) / 2 : r.top,
    );
    const from = shown.current;
    const to = target === 'fit' ? fit : target;
    begin();
    const t0 = performance.now();
    const step = (t: number) => {
      const k = clamp((t - t0) / ZOOM_MS, 0, 1);
      draw(p, from + (to - from) * (1 - (1 - k) ** 3), anchor);
      if (k < 1) frame.current = requestAnimationFrame(step);
      else commit(p, target, anchor);
    };
    frame.current = requestAnimationFrame(step);
  };
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
  width,
}: BracketTreeProps & { node: TournamentNode; left: number; top: number; width: number; styles: Styles }) {
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

  // Between the two players: the score once it's played (⏳ while the other
  // player still has to confirm it), else when it's on.
  let middle: React.ReactNode = null;
  let said: string | null = null;
  if (score) {
    middle = <Text style={styles.midScore}>{score}</Text>;
    said = `${winner} won ${score}`;
  } else if (node.walkover) {
    middle = <Text style={styles.midMuted}>Walkover</Text>;
    said = `${winner} won on a walkover`;
  } else if (node.pending) {
    const aWon = sideAWon(node.pending.games);
    const waiting = scoreLine(node.pending.games, aWon);
    middle = (
      <Text style={[styles.midWaiting, pressable && styles.midAction]} numberOfLines={1}>
        {waiting} ⏳{pressable ? ' ›' : ''}
      </Text>
    );
    said = `${aWon ? nameA : nameB} won ${waiting}, waiting to be confirmed`;
  } else if (time) {
    middle = (
      <Text style={[styles.midTime, pressable && styles.midAction, overdue && styles.midOverdue]} numberOfLines={1}>
        {time}
        {pressable ? ' ›' : ''}
      </Text>
    );
    said = overdue ? `was due ${time}` : time;
  }

  // Each player's points in every game, on their row: the match's, or the
  // result waiting to be confirmed (paler until it is).
  const games = node.games.length > 0 ? node.games : node.pending?.games ?? [];
  const gamesWaiting = node.games.length === 0 && !!node.pending;

  const between = (
    <>
      <View style={styles.midLine} />
      {middle}
      {middle && <View style={styles.midLine} />}
    </>
  );
  // Each player opens their profile; the line between them, when the match is
  // the viewer's to record or manage, opens that.
  return (
    <View
      style={[styles.box, { left, top, width }, ready && styles.boxReady, mine && styles.boxMine, bye && styles.boxBye]}
    >
      <Side
        id={node.playerA}
        name={nameA}
        avatarUrl={avatarOf(node.playerA)}
        isWinner={!!node.winnerId && node.winnerId === node.playerA}
        isMe={!!meId && node.playerA === meId}
        points={games.map((g) => ({ mine: g.a, theirs: g.b }))}
        waiting={gamesWaiting}
        styles={styles}
      />
      {pressable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={[`${nameA} v ${nameB}`, said].filter(Boolean).join(', ')}
          onPress={() => onPressMatch(node)}
          hitSlop={{ top: 4, bottom: 4 }}
          style={styles.mid}
        >
          {between}
        </Pressable>
      ) : (
        <View style={styles.mid} accessibilityLabel={[`${nameA} v ${nameB}`, said].filter(Boolean).join(', ')}>
          {between}
        </View>
      )}
      <Side
        id={node.playerB}
        name={nameB}
        avatarUrl={avatarOf(node.playerB)}
        isWinner={!!node.winnerId && node.winnerId === node.playerB}
        isMe={!!meId && node.playerB === meId}
        points={games.map((g) => ({ mine: g.b, theirs: g.a }))}
        waiting={gamesWaiting}
        styles={styles}
      />
    </View>
  );
}

// One player of a match: photo (with their tier ring) and name, opening their
// profile, then their points in each game played (bold where they won the
// game); or an empty circle while it's not known who plays.
function Side({
  id,
  name,
  avatarUrl,
  isWinner,
  isMe,
  points,
  waiting,
  styles,
}: {
  id: string | null;
  name: string;
  avatarUrl: string | null;
  isWinner: boolean;
  isMe: boolean;
  points: { mine: number; theirs: number }[];
  waiting: boolean;
  styles: Styles;
}) {
  return (
    <PlayerLink playerId={id} name={name} style={styles.side}>
      {id ? <Avatar uri={avatarUrl} name={name} size={AVATAR} playerId={id} /> : <View style={styles.avatarEmpty} />}
      <Text style={[styles.name, isMe && styles.nameMe, isWinner && styles.nameWinner]} numberOfLines={1}>
        {withYou(name, isMe)}
      </Text>
      {points.length > 0 && (
        <View style={[styles.points, waiting && styles.pointsWaiting]}>
          {points.map((p, i) => (
            <Text key={i} style={[styles.point, p.mine > p.theirs && styles.pointWon]}>
              {p.mine}
            </Text>
          ))}
        </View>
      )}
    </PlayerLink>
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
      width: BOX_W, // (each box gets its tournament's width)
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
    name: { color: colors.text, fontSize: 13, flex: 1 },
    // A player's points in each game, in columns that line up with the other player's.
    points: { flexDirection: 'row', gap: SET_W - 15 },
    pointsWaiting: { opacity: 0.6 },
    point: { width: 15, textAlign: 'right', color: colors.textMuted, fontSize: 11, fontVariant: ['tabular-nums'] },
    pointWon: { color: colors.text, fontWeight: '700' },
    nameMe: { fontWeight: '700' },
    nameWinner: { color: colors.success, fontWeight: '700' },
    mid: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 20 },
    midLine: { flex: 1, height: 1, backgroundColor: colors.border },
    midScore: { color: colors.text, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
    midMuted: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
    midWaiting: { color: colors.textMuted, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
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
