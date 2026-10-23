import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { HowRatingsWorkScreen } from '@/screens/HowRatingsWorkScreen';
import { LeaderboardScreen } from '@/screens/LeaderboardScreen';
import { PlayerProfileScreen } from '@/screens/PlayerProfileScreen';
import { useTheme } from '@/theme';

import type { LeaderboardStackParamList } from './types';

const Stack = createNativeStackNavigator<LeaderboardStackParamList>();

export function LeaderboardStack() {
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
      <Stack.Screen name="Leaderboard" component={LeaderboardScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="PlayerProfile"
        component={PlayerProfileScreen}
        options={({ route }) => ({ title: route.params.displayName })}
      />
      <Stack.Screen
        name="HowRatingsWork"
        component={HowRatingsWorkScreen}
        options={{ title: 'How ratings work' }}
      />
    </Stack.Navigator>
  );
}
