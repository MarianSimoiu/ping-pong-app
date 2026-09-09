import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import React from 'react';
import { Text } from 'react-native';

import { HomeScreen } from '@/screens/HomeScreen';
import { LeaderboardScreen } from '@/screens/LeaderboardScreen';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { TournamentsScreen } from '@/screens/TournamentsScreen';
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
      <Tab.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
      <Tab.Screen name="Leaderboard" component={LeaderboardScreen} options={{ headerShown: false }} />
      <Tab.Screen name="Tournaments" component={TournamentsScreen} options={{ headerShown: false }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ headerShown: false }} />
    </Tab.Navigator>
  );
}
