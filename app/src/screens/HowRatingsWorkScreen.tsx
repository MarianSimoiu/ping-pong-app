import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { STREAK_MIN, UPSET_DELTA_THRESHOLD } from '@/lib/commentary';
import { MIN_MATCHES_FOR_LEADERBOARD } from '@/lib/constants';
import { radius, spacing, useTheme, type Colors } from '@/theme';

// Every rating rule in plain language, in one place (opened from the ⓘ icons
// and links on Home, Leaderboard, Profile and player profiles). Numbers come
// from the app's constants where it has them; the same-opponent damping and
// the season-points table mirror supabase/functions/_shared/glicko2.ts
// (repeatFactor) and points.ts, so update this page when those change.

const N = MIN_MATCHES_FOR_LEADERBOARD;

const SEASON_POINTS: [string, number][] = [
  ['Champion', 100],
  ['Runner-up', 60],
  ['Semifinalist', 36],
  ['Quarterfinalist', 18],
  ['Round of 16', 9],
  ['Round of 32', 4],
];

export function HowRatingsWorkScreen() {
  const styles = useStyles();

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          The short version: win confirmed matches, especially against stronger players. The
          details are below.
        </Text>

        <Section title="Skill rating">
          <P>
            Everyone starts at <B>1500</B>. After every confirmed match, your rating moves by how
            surprising the result was:
          </P>
          <Bullet>Beat someone rated well above you: a big gain.</Bullet>
          <Bullet>Beat someone rated well below you: it barely moves, since you were expected to win.</Bullet>
          <Bullet>Lose to someone rated well below you: a big drop.</Bullet>
          <P>
            So playing easy opponents over and over can't pump up a rating. Only who won the match
            counts, not the game scores.
          </P>
        </Section>

        <Section title="± (how sure the rating is)">
          <P>
            The <B>±</B> next to a rating is its uncertainty: <B>smaller means more reliable</B>.
            For example, 1600 ± 80 means the real level is very likely between about 1440 and 1760.
          </P>
          <Bullet>
            Everyone starts at ± 350, and every confirmed match shrinks it: roughly ± 200 after 3
            matches, ± 130 after 10 and ± 90 after 20.
          </Bullet>
          <Bullet>
            While it's big, each result moves your rating a lot, so new players climb or drop fast.
            Once it's small, results only nudge it.
          </Bullet>
          <Bullet>
            After a long break it grows a little, because the system is less sure you're still at
            that level. That shows up at your next match, which moves your rating a bit more.
          </Bullet>
        </Section>

        <Section title="The leaderboard">
          <P>
            You appear on the leaderboard after <B>{N} confirmed matches</B>. Your first {N} matches
            move your rating the most.
          </P>
          <P>
            Players are ranked by rating alone; the ± says how far to trust each number. A newcomer
            at 1750 ± 200 can rank above a regular at 1700 ± 70, but their rating is far less
            certain.
          </P>
        </Section>

        <Section title="Recording matches">
          <P>
            Record a match from Home. It only counts once <B>your opponent confirms it</B>: they
            see it under "Awaiting your confirmation". If they decline, it never counts. Matches
            you're waiting on show under "Awaiting opponent's confirmation".
          </P>
        </Section>

        <Section title="Playing the same person a lot">
          <P>Within 24 hours, matches against the same opponent move ratings less:</P>
          <Bullet>1st and 2nd match: full effect</Bullet>
          <Bullet>3rd: half</Bullet>
          <Bullet>4th: a quarter</Bullet>
          <Bullet>5th and later: no rating change</Bullet>
          <P>They still count as matches played and in your win–loss record.</P>
        </Section>

        <Section title="Tournaments and season points">
          <P>
            Tournament matches change your skill rating like any other match. Either player or the
            organizer records the result, with no confirmation step. Only admins can create
            tournaments.
          </P>
          <P>
            <B>Season points</B> are a separate ranking (the Season points tab), earned only by how
            far you get in a tournament:
          </P>
          <View style={styles.table}>
            {SEASON_POINTS.map(([finish, points], i) => (
              <View key={finish} style={[styles.tableRow, i > 0 && styles.tableDivider]}>
                <Text style={styles.tableCell}>{finish}</Text>
                <Text style={[styles.tableCell, styles.tablePoints]}>{points}</Text>
              </View>
            ))}
          </View>
          <P>Your best 8 results from the last 52 weeks count; older ones drop off.</P>
        </Section>

        <Section title="Labels you'll see">
          <Bullet>
            <B>🔥 SHOCKER</B> (or 😱 on a loss): a match that moved the rating by{' '}
            {UPSET_DELTA_THRESHOLD} points or more, so an upset.
          </Bullet>
          <Bullet>
            <B>Streak banner</B>: {STREAK_MIN} or more wins (or losses) in a row.
          </Bullet>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function useStyles() {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [colors]);
}

type Children = { children: React.ReactNode };

function P({ children }: Children) {
  return <Text style={useStyles().p}>{children}</Text>;
}

function B({ children }: Children) {
  return <Text style={useStyles().bold}>{children}</Text>;
}

function Bullet({ children }: Children) {
  const styles = useStyles();
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={[styles.p, styles.bulletText]}>{children}</Text>
    </View>
  );
}

function Section({ title, children }: Children & { title: string }) {
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg, paddingBottom: spacing.xl },
    intro: { color: colors.text, fontSize: 15, lineHeight: 22, marginBottom: spacing.md },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      gap: spacing.sm,
    },
    cardTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
    p: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
    bold: { color: colors.text, fontWeight: '700' },
    bulletRow: { flexDirection: 'row', gap: spacing.sm },
    bulletDot: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
    bulletText: { flex: 1 },
    table: {
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    tableRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
    },
    tableDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    tableCell: { color: colors.text, fontSize: 14 },
    tablePoints: { fontWeight: '700' },
  });
}
