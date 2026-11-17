import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { HomeScreen } from '@/screens/HomeScreen';
import { HowRatingsWorkScreen } from '@/screens/HowRatingsWorkScreen';
import { PlayerProfileScreen } from '@/screens/PlayerProfileScreen';
import { SubmitMatchScreen } from '@/screens/SubmitMatchScreen';
import { useTheme } from '@/theme';

import type { HomeStackParamList } from './types';

const Stack = createNativeStackNavigator<HomeStackParamList>();

export function HomeStack() {
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
      <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="SubmitMatch"
        component={SubmitMatchScreen}
        options={{ title: 'Record a match', presentation: 'modal' }}
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
