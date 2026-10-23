import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { InstallSheet } from '@/components/InstallSheet';
import { AuthProvider } from '@/context/AuthContext';
import { RootNavigator } from '@/navigation/RootNavigator';
import { ThemeProvider, useTheme } from '@/theme';

function AppChrome() {
  const { statusBarStyle } = useTheme();
  return (
    <>
      <StatusBar style={statusBarStyle} />
      <RootNavigator />
      {Platform.OS === 'web' && <InstallSheet />}
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ThemeProvider>
          <AppChrome />
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
