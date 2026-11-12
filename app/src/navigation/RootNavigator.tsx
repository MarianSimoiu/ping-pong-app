import { createNavigationContainerRef, DarkTheme, NavigationContainer } from '@react-navigation/native';
import React, { useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import { NewPasswordScreen } from '@/screens/NewPasswordScreen';
import { SignInScreen } from '@/screens/SignInScreen';
import { useTheme } from '@/theme';

import { linking } from './linking';
import { TabNavigator } from './TabNavigator';
import type { TabParamList } from './types';

// For the popups drawn outside the screens (e.g. "New titles" opening Profile).
export const navigationRef = createNavigationContainerRef<TabParamList>();

export function RootNavigator() {
  const { session, initializing, recovering } = useAuth();
  const { colors } = useTheme();

  // `DarkTheme` here is just React Navigation's base theme shape (it always
  // has light text/dark chrome) — our own colors below are what actually
  // make this light or dark.
  const navTheme = useMemo(
    () => ({
      ...DarkTheme,
      colors: {
        ...DarkTheme.colors,
        background: colors.background,
        card: colors.surface,
        border: colors.border,
        text: colors.text,
        primary: colors.primary,
      },
    }),
    [colors],
  );

  if (initializing) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} linking={linking}>
      {!session ? <SignInScreen /> : recovering ? <NewPasswordScreen /> : <TabNavigator />}
    </NavigationContainer>
  );
}
