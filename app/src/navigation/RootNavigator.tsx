import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import { SignInScreen } from '@/screens/SignInScreen';
import { colors } from '@/theme';

import { TabNavigator } from './TabNavigator';

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.surface,
    border: colors.border,
    text: colors.text,
    primary: colors.primary,
  },
};

export function RootNavigator() {
  const { session, initializing } = useAuth();

  if (initializing) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      {session ? <TabNavigator /> : <SignInScreen />}
    </NavigationContainer>
  );
}
