import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { HomeScreen } from '@/screens/HomeScreen';
import { SubmitMatchScreen } from '@/screens/SubmitMatchScreen';
import { colors } from '@/theme';

import type { HomeStackParamList } from './types';

const Stack = createNativeStackNavigator<HomeStackParamList>();

export function HomeStack() {
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
    </Stack.Navigator>
  );
}
