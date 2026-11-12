import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { useGradientId } from '@/components/Avatar';
import { BottomSheet, SheetButton, SheetHeader } from '@/components/BottomSheet';
import { useAuth } from '@/context/AuthContext';
import { useBadges } from '@/context/BadgesContext';
import { installPopupThisVisit } from '@/lib/install';
import { pushPromptThisVisit } from '@/lib/push';
import { RING_COLORS, TIER_EMOJI, TIER_NAMES, TIERS, tierRank, type Tier } from '@/lib/tiers';
import { useTheme, type Colors } from '@/theme';

// The last tier this device showed the player, per player.
const seenKey = (playerId: string) => `pingpong.tier.seen.${playerId}`;
function readSeen(playerId: string): Tier | null {
  try {
    const v = globalThis.localStorage?.getItem(seenKey(playerId));
    return v && (TIERS as readonly string[]).includes(v) ? (v as Tier) : null;
  } catch {
    return null;
  }
}
function writeSeen(playerId: string, tier: Tier) {
  try {
    globalThis.localStorage?.setItem(seenKey(playerId), tier);
  } catch {
    // Private mode: it shows again next time, no harm.
  }
}

let shownThisVisit = false;
// Whether the tier popup opened in this visit (the notifications popup then waits).
export const tierPopupThisVisit = () => shownThisVisit;

type Moment = { kind: 'intro' | 'placement' | 'promotion'; tier: Tier };

// "Promoted to Gold": shown once per device when the signed-in player's tier
// went up since they last saw it (or the first time they see tiers at all).
// Drops are noted silently. Never in a visit with another popup.
export function TierCelebration() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { recovering } = useAuth();
  const { badges, meId, loaded, lines } = useBadges();
  const [moment, setMoment] = useState<Moment | null>(null);
  const tier = meId ? badges[meId]?.tier : undefined;

  useEffect(() => {
    if (!loaded || !meId || !tier || recovering) return;
    const seen = readSeen(meId);
    if (tier === 'unranked' || (seen && tierRank(tier) <= tierRank(seen))) {
      if (seen !== tier) writeSeen(meId, tier);
      return;
    }
    const timer = setTimeout(() => {
      if (installPopupThisVisit() || pushPromptThisVisit()) return; // next visit
      shownThisVisit = true;
      setMoment({ kind: !seen ? 'intro' : seen === 'unranked' ? 'placement' : 'promotion', tier });
    }, 1200);
    return () => clearTimeout(timer);
  }, [loaded, meId, tier, recovering]);

  function close() {
    if (meId && moment) writeSeen(meId, moment.tier);
    setMoment(null);
  }

  if (!moment) return null;
  const name = `${TIER_NAMES[moment.tier]} ${TIER_EMOJI[moment.tier]}`;
  const nextTier = TIERS[tierRank(moment.tier) + 1];
  const nextLine = lines.find((l) => l.tier === nextTier);
  const next = nextLine
    ? `Next up: ${TIER_NAMES[nextTier]} at ${Math.round(nextLine.minRating)}.`
    : 'The top tier. Top the leaderboard to become Legend.';
  const title =
    moment.kind === 'promotion' ? `Promoted to ${name}` : moment.kind === 'placement' ? `Placed in ${name}` : `You're ${name}`;
  const lead =
    moment.kind === 'intro'
      ? `Tiers are here: your rating puts you in ${TIER_NAMES[moment.tier]}, and your avatar now wears its ring.`
      : moment.kind === 'placement'
        ? "You've played 3 matches: you're on the leaderboard with your first tier."
        : 'Your rating crossed the line.';

  return (
    <BottomSheet visible onDismiss={close} nativeID="tier-sheet">
      <SheetHeader
        icon={<Emblem tier={moment.tier} />}
        title={title}
        subtitle={`${lead} ${next}`}
      />
      <Text style={styles.note}>Tiers: Bronze, Silver, Gold, Platinum, Diamond. #1 on the leaderboard is Legend.</Text>
      <SheetButton label="Nice!" onPress={close} />
    </BottomSheet>
  );
}

function Emblem({ tier }: { tier: Tier }) {
  const size = 64;
  const stroke = 4;
  const [from, to] = RING_COLORS[tier === 'unranked' ? 'inactive' : tier];
  const gradientId = useGradientId('emblem');
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={(size - stroke) / 2} stroke={`url(#${gradientId})`} strokeWidth={stroke} fill="none" />
      </Svg>
      <Text style={{ fontSize: 30 }}>{TIER_EMOJI[tier]}</Text>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    note: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginBottom: 4 },
  });
}
