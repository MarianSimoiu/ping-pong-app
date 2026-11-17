import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { DoublesScreen } from '@/screens/DoublesScreen';
import { HowRatingsWorkScreen } from '@/screens/HowRatingsWorkScreen';
import { PlayerProfileScreen } from '@/screens/PlayerProfileScreen';
import { RecordDoublesMatchScreen } from '@/screens/RecordDoublesMatchScreen';
import { useTheme } from '@/theme';

import type { DoublesStackParamList } from './types';

const Stack = createNativeStackNavigator<DoublesStackParamList>();

export function DoublesStack() {
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
      <Stack.Screen name="DoublesHome" component={DoublesScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="RecordDoublesMatch"
        component={RecordDoublesMatchScreen}
        options={{ title: 'Record a doubles match', presentation: 'modal' }}
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
