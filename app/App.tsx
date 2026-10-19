import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@/context/AuthContext';
import { RootNavigator } from '@/navigation/RootNavigator';
import { ThemeProvider, useTheme } from '@/theme';

function AppChrome() {
  const { statusBarStyle } = useTheme();
  return (
    <>
      <StatusBar style={statusBarStyle} />
      <RootNavigator />
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <AppChrome />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
