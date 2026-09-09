import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Placeholder } from '@/components/Placeholder';
import { colors } from '@/theme';

export function TournamentsScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <Placeholder
        emoji="🎽"
        title="Tournaments"
        note="Creating tournaments, seeding, and brackets arrive in Phase 4. Tournament results feed both your skill rating and season points."
      />
    </SafeAreaView>
  );
}
