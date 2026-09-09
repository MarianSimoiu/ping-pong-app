import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { CreateTournamentScreen } from '@/screens/CreateTournamentScreen';
import { RecordTournamentMatchScreen } from '@/screens/RecordTournamentMatchScreen';
import { TournamentDetailScreen } from '@/screens/TournamentDetailScreen';
import { TournamentsScreen } from '@/screens/TournamentsScreen';
import { colors } from '@/theme';

import type { TournamentsStackParamList } from './types';

const Stack = createNativeStackNavigator<TournamentsStackParamList>();

export function TournamentsStack() {
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
        options={({ route }) => ({ title: route.params.name })}
      />
      <Stack.Screen
        name="RecordTournamentMatch"
        component={RecordTournamentMatchScreen}
        options={{ title: 'Record result', presentation: 'modal' }}
      />
    </Stack.Navigator>
  );
}
