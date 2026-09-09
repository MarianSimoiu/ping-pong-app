import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Placeholder } from '@/components/Placeholder';
import { colors } from '@/theme';

export function LeaderboardScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <Placeholder
        emoji="🏆"
        title="Leaderboard"
        note="Skill and season-points rankings arrive in Phase 3. Players appear once they've played the minimum number of matches."
      />
    </SafeAreaView>
  );
}
