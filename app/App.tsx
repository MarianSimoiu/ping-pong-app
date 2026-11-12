import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { InstallSheet } from '@/components/InstallSheet';
import { PushPromptSheet } from '@/components/PushPromptSheet';
import { TierCelebration } from '@/components/TierCelebration';
import { TitleCelebration } from '@/components/TitleCelebration';
import { AuthProvider } from '@/context/AuthContext';
import { BadgesProvider } from '@/context/BadgesContext';
import { RootNavigator } from '@/navigation/RootNavigator';
import { ThemeProvider, useTheme } from '@/theme';

function AppChrome() {
  const { statusBarStyle } = useTheme();
  return (
    <>
      <StatusBar style={statusBarStyle} />
      <RootNavigator />
      {Platform.OS === 'web' && (
        <>
          <InstallSheet />
          <PushPromptSheet />
          <TierCelebration />
          <TitleCelebration />
        </>
      )}
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <BadgesProvider>
          <ThemeProvider>
            <AppChrome />
          </ThemeProvider>
        </BadgesProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
