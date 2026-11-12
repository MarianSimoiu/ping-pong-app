import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useBadge, useBadges } from '@/context/BadgesContext';
import { MIN_MATCHES_FOR_LEADERBOARD } from '@/lib/constants';
import {
  RING_COLORS,
  TIER_EMOJI,
  TIER_NAMES,
  TIERS,
  ringFor,
  tierLabel,
  tierProgress,
  tierRank,
} from '@/lib/tiers';
import { radius, spacing, useTheme, type Colors } from '@/theme';

// How far under a tier's line a player can fall before dropping out of it
// (tier_hysteresis() in migration 0014).
const DROP_MARGIN = 25;

// A player's tier on their profile, with the way to the next one.
export function TierCard({
  playerId,
  rating,
  matchesPlayed,
  isMe,
}: {
  playerId: string | null | undefined;
  rating: number;
  matchesPlayed: number;
  isMe: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const badge = useBadge(playerId);
  const { lines } = useBadges();
  if (!badge) return null;

  if (badge.tier === 'unranked') {
    const more = Math.max(1, MIN_MATCHES_FOR_LEADERBOARD - matchesPlayed);
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Unranked</Text>
        <Text style={styles.hint}>
          {isMe ? `Play ${more} more ${more === 1 ? 'match' : 'matches'} to get your tier.` : 'No tier yet.'}
        </Text>
      </View>
    );
  }

  const ring = ringFor(badge) ?? badge.tier;
  const accent = RING_COLORS[ring][1];
  const progress = tierProgress(badge.tier, rating, lines);
  const ownLine = lines.find((l) => l.tier === badge.tier)?.minRating;
  const lower = TIERS[tierRank(badge.tier) - 1];
  const nearDrop = ownLine !== undefined && rating < ownLine && lower && lower !== 'unranked';
  const best = badge.bestTier;

  return (
    <View style={[styles.card, { borderColor: accent }]}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{tierLabel(badge)}</Text>
        {badge.legend && <Text style={styles.sub}>#1 on the leaderboard</Text>}
      </View>
      {badge.inactive && (
        <Text style={styles.inactive}>
          Inactive: no match for 30 days, so the ring is grey. {isMe ? 'Play one to light it up again.' : ''}
        </Text>
      )}
      {progress && (
        <>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(progress.fraction * 100)}%`, backgroundColor: accent }]} />
          </View>
          <Text style={styles.hint}>
            {progress.toGo > 0
              ? `${progress.toGo} to ${TIER_EMOJI[progress.next]} ${TIER_NAMES[progress.next]} (${progress.nextAt})`
              : `${TIER_EMOJI[progress.next]} ${TIER_NAMES[progress.next]} after the next result`}
          </Text>
        </>
      )}
      {!progress && badge.tier === 'diamond' && !badge.legend && (
        <Text style={styles.hint}>The top tier. Top the leaderboard to become Legend.</Text>
      )}
      {nearDrop && ownLine !== undefined && (
        <Text style={styles.warn}>
          Under the {TIER_NAMES[badge.tier]} line: below {Math.round(ownLine - DROP_MARGIN)} it drops to{' '}
          {TIER_NAMES[lower]}.
        </Text>
      )}
      {tierRank(best) > tierRank(badge.tier) && (
        <Text style={styles.hint}>
          Best: {TIER_EMOJI[best]} {TIER_NAMES[best]}
        </Text>
      )}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1.5,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.sm,
      marginTop: spacing.md,
      marginBottom: spacing.md,
    },
    titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
    title: { color: colors.text, fontSize: 18, fontWeight: '800' },
    sub: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
    track: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
    fill: { height: 8, borderRadius: 4 },
    hint: { color: colors.textMuted, fontSize: 13 },
    warn: { color: colors.danger, fontSize: 13 },
    inactive: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },
  });
}
