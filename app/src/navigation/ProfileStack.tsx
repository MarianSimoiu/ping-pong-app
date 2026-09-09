import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { PlayerProfileScreen } from '@/screens/PlayerProfileScreen';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { colors } from '@/theme';

import type { ProfileStackParamList } from './types';

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export function ProfileStack() {
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
      <Stack.Screen name="Account" component={ProfileScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="PlayerProfile"
        component={PlayerProfileScreen}
        options={({ route }) => ({ title: route.params.displayName })}
      />
    </Stack.Navigator>
  );
}
