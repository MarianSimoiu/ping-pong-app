import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import React from 'react';
import { Text } from 'react-native';

import { HomeStack } from '@/navigation/HomeStack';
import { LeaderboardStack } from '@/navigation/LeaderboardStack';
import { ProfileStack } from '@/navigation/ProfileStack';
import { TournamentsStack } from '@/navigation/TournamentsStack';
import { colors } from '@/theme';

const Tab = createBottomTabNavigator();

// Emoji tab icons keep Phase 1 dependency-free (no icon font needed yet).
const icons: Record<string, string> = {
  Home: '🏓',
  Leaderboard: '🏆',
  Tournaments: '🎽',
  Profile: '👤',
};

export function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: { color: colors.text },
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarIcon: ({ color }) => (
          <Text style={{ fontSize: 18, color }}>{icons[route.name] ?? '•'}</Text>
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeStack} options={{ headerShown: false }} />
      <Tab.Screen name="Leaderboard" component={LeaderboardStack} options={{ headerShown: false }} />
      <Tab.Screen name="Tournaments" component={TournamentsStack} options={{ headerShown: false }} />
      <Tab.Screen name="Profile" component={ProfileStack} options={{ headerShown: false }} />
    </Tab.Navigator>
  );
}
