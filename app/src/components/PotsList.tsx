import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { groupByPot, potCountFor, potSizes, round1ByPot, round1Text } from '@/lib/pots';
import { MIN_TOURNAMENT_PLAYERS, type TournamentParticipant } from '@/lib/tournaments';
import { radius, spacing, useTheme, type Colors } from '@/theme';

// "Ana (you)" for the signed-in player (the demo's player is already "You").
export function withYou(name: string, isMe: boolean): string {
  return isMe && name !== 'You' ? `${name} (you)` : name;
}

const rounded = (n: number) => Math.round(n);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// How the pots are made, with the split as it stands right now. Shown above
// the live pots while a tournament is open for registration.
export function PotRules({ count }: { count: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const sizes = potSizes(count);
  const pots = potCountFor(count);
  const now =
    count >= 2
      ? `Right now: ${plural(count, 'player', 'players')} → ${pots} pots of ${sizes.join(' · ')}.`
      : count === 1
        ? 'Right now: 1 player. Pots start at 2.'
        : 'No one has registered yet.';
  const rules = [
    'Everyone registered is ranked by rating, best first (equal ratings: whoever registered first).',
    '8 or more players make 4 pots, fewer make 2. Each pot takes the next slice of the ranking, as equal as possible; the top pots take any extra player.',
    'Pots update live as players register, withdraw or play rated matches, and freeze at kickoff.',
    'At kickoff each pot is shuffled for the draw. With 4, 8, 16, 32… players, round 1 is Pot 1 v Pot 4 and Pot 2 v Pot 3 (Pot 1 v Pot 2 with two pots); otherwise the top seeds get byes, Pot 1 first.',
    count >= MIN_TOURNAMENT_PLAYERS
      ? "Each pot shows its round 1 as it would be if the draw were made now."
      : `Each pot shows its round 1 once ${MIN_TOURNAMENT_PLAYERS} players are in.`,
  ];
  return (
    <View style={styles.rules}>
      <Text style={styles.rulesTitle}>How the pots are made</Text>
      {rules.map((rule) => (
        <View key={rule} style={styles.rule}>
          <Text style={styles.bullet}>•</Text>
          <Text style={styles.ruleText}>{rule}</Text>
        </View>
      ))}
      <Text style={styles.now}>{now}</Text>
    </View>
  );
}

// A tournament's players grouped by pot, each pot with the ranks and ratings
// it covers. `live`: registration is open, so each pot also says what round 1
// would be if the draw were made now. `frozen`: the pots as the draw used
// them. `plain`: just the players (no pots: cancelled or older tournaments).
export function PotsList({
  participants,
  meId,
  mode,
}: {
  participants: TournamentParticipant[];
  meId: string | null;
  mode: 'live' | 'frozen' | 'plain';
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const groups = groupByPot(participants);
  const sizes = groups.map((g) => g.players.length);
  const round1 =
    mode === 'live' && participants.length >= MIN_TOURNAMENT_PLAYERS && groups.every((g) => g.pot !== null)
      ? round1ByPot(sizes)
      : null;

  return (
    <View style={{ gap: spacing.md }}>
      {groups.map((group, i) => {
        const pot = mode !== 'plain' ? group.pot : null;
        const ranks =
          group.rankFrom === group.rankTo ? `Rank ${group.rankFrom}` : `Ranks ${group.rankFrom}–${group.rankTo}`;
        const low = group.ratingLow !== null ? rounded(group.ratingLow) : null;
        const high = group.ratingHigh !== null ? rounded(group.ratingHigh) : null;
        const ratings = low === null || high === null ? '' : low === high ? ` · rating ${high}` : ` · rating ${low}–${high}`;
        return (
          <View key={group.pot ?? 'all'} style={styles.pot} accessibilityLabel={pot ? `Pot ${pot}` : 'Players'}>
            <View style={styles.potHeader}>
              <Text style={styles.potName}>{pot ? `Pot ${pot}` : 'Players'}</Text>
              <Text style={styles.potCount}>{plural(group.players.length, 'player', 'players')}</Text>
            </View>
            {pot !== null && (
              <Text style={styles.potRule}>
                {ranks}
                {mode === 'frozen' ? ' at the draw' : ''}
                {ratings}
              </Text>
            )}
            {pot !== null && round1 && (
              <View style={styles.round1}>
                <Text style={styles.round1Label}>Round 1</Text>
                <Text style={styles.round1Text}>{round1Text(pot, group.players.length, round1[i])}</Text>
              </View>
            )}
            <View style={styles.players}>
              {group.players.map((p) => {
                const isMe = p.playerId === meId;
                return (
                  <View key={p.playerId} style={[styles.player, isMe && styles.playerMe]}>
                    {pot !== null && <Text style={styles.rank}>#{p.rank}</Text>}
                    <Avatar uri={p.avatarUrl} name={p.name} size={28} />
                    <Text style={[styles.name, isMe && styles.nameMe]} numberOfLines={1}>
                      {withYou(p.name, isMe)}
                    </Text>
                    {p.rating !== null && <Text style={styles.rating}>{rounded(p.rating)}</Text>}
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    rules: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: 6,
      marginBottom: spacing.md,
    },
    rulesTitle: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 2 },
    rule: { flexDirection: 'row', gap: spacing.sm },
    bullet: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
    ruleText: { color: colors.textMuted, fontSize: 13, lineHeight: 19, flex: 1 },
    now: { color: colors.text, fontSize: 14, fontWeight: '700', marginTop: spacing.xs },
    pot: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 4,
      gap: 6,
    },
    potHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    potName: { color: colors.text, fontSize: 17, fontWeight: '800' },
    potCount: { color: colors.textMuted, fontSize: 12 },
    potRule: { color: colors.text, fontSize: 13, fontWeight: '600' },
    round1: {
      flexDirection: 'row',
      gap: spacing.sm,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 6,
    },
    round1Label: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      lineHeight: 18,
    },
    round1Text: { color: colors.text, fontSize: 13, lineHeight: 18, flex: 1 },
    players: { marginTop: 2 },
    player: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: 6,
      paddingHorizontal: spacing.xs,
      borderRadius: radius.sm,
    },
    playerMe: { backgroundColor: colors.surfaceAlt },
    rank: { color: colors.textMuted, fontSize: 12, fontWeight: '700', width: 28, fontVariant: ['tabular-nums'] },
    name: { color: colors.text, fontSize: 15, flex: 1 },
    nameMe: { fontWeight: '700' },
    rating: { color: colors.textMuted, fontSize: 13, fontVariant: ['tabular-nums'] },
  });
}
