import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import React from 'react';
import { Text } from 'react-native';

import { PodiumIcon } from '@/components/PodiumIcon';
import { DoublesStack } from '@/navigation/DoublesStack';
import { HomeStack } from '@/navigation/HomeStack';
import { LeaderboardStack } from '@/navigation/LeaderboardStack';
import { ProfileStack } from '@/navigation/ProfileStack';
import { TournamentsStack } from '@/navigation/TournamentsStack';
import type { TabParamList } from '@/navigation/types';
import { useTheme } from '@/theme';

const Tab = createBottomTabNavigator<TabParamList>();

// Emoji tab icons keep Phase 1 dependency-free (no icon font needed yet).
// The Leaderboard's podium has no emoji, so it's drawn (PodiumIcon).
const icons: Record<string, string> = {
  Home: '🏓',
  Tournaments: '🏆',
  Doubles: '🤝',
  Profile: '👤',
};

export function TabNavigator() {
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: { color: colors.text },
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarIcon: ({ color }) =>
          route.name === 'Leaderboard' ? (
            <PodiumIcon size={22} />
          ) : (
            <Text style={{ fontSize: 18, color }}>{icons[route.name] ?? '•'}</Text>
          ),
      })}
    >
      <Tab.Screen name="Home" component={HomeStack} options={{ headerShown: false }} />
      <Tab.Screen name="Leaderboard" component={LeaderboardStack} options={{ headerShown: false }} />
      <Tab.Screen name="Tournaments" component={TournamentsStack} options={{ headerShown: false }} />
      <Tab.Screen name="Doubles" component={DoublesStack} options={{ headerShown: false }} />
      <Tab.Screen name="Profile" component={ProfileStack} options={{ headerShown: false }} />
    </Tab.Navigator>
  );
}
