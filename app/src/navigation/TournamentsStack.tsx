import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { CreateTournamentScreen } from '@/screens/CreateTournamentScreen';
import { HowRatingsWorkScreen } from '@/screens/HowRatingsWorkScreen';
import { PlayerProfileScreen } from '@/screens/PlayerProfileScreen';
import { RecordTournamentMatchScreen } from '@/screens/RecordTournamentMatchScreen';
import { TournamentDetailScreen } from '@/screens/TournamentDetailScreen';
import { TournamentsScreen } from '@/screens/TournamentsScreen';
import { useTheme } from '@/theme';

import type { TournamentsStackParamList } from './types';

const Stack = createNativeStackNavigator<TournamentsStackParamList>();

export function TournamentsStack() {
  const { colors } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: { color: colors.text },
        headerTintColor: colors.primary,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="TournamentsList" component={TournamentsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CreateTournament" component={CreateTournamentScreen} options={{ title: 'New tournament' }} />
      <Stack.Screen
        name="TournamentDetail"
        component={TournamentDetailScreen}
        // A link from a notification has no name; the screen sets it once loaded.
        options={({ route }) => ({ title: route.params.name ?? 'Tournament' })}
      />
      <Stack.Screen
        name="RecordTournamentMatch"
        component={RecordTournamentMatchScreen}
        options={{ title: 'Record result', presentation: 'modal' }}
      />
      <Stack.Screen
        name="PlayerProfile"
        component={PlayerProfileScreen}
        // From a link there's no name yet; the screen sets it once loaded.
        options={({ route }) => ({ title: route.params.displayName ?? 'Player' })}
      />
      <Stack.Screen
        name="HowRatingsWork"
        component={HowRatingsWorkScreen}
        options={{ title: 'How ratings work' }}
      />
    </Stack.Navigator>
  );
}
