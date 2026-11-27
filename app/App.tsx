import { LilitaOne_400Regular } from '@expo-google-fonts/lilita-one';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { InstallSheet } from '@/components/InstallSheet';
import { PushPromptSheet } from '@/components/PushPromptSheet';
import { TierCelebration } from '@/components/TierCelebration';
import { TitleCelebration } from '@/components/TitleCelebration';
import { WhatsNewSheet } from '@/components/WhatsNewSheet';
import { AuthProvider } from '@/context/AuthContext';
import { BadgesProvider } from '@/context/BadgesContext';
import { startUpdateChecks } from '@/lib/appUpdate';
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
          <WhatsNewSheet />
        </>
      )}
    </>
  );
}

export default function App() {
  // The lettering on trophies and medals (components/TournamentArt.tsx).
  // Nothing waits for it: until it's in, they use a fallback font.
  useFonts({ LilitaOne_400Regular });
  // Back on screen after a deploy: reload into the new version (lib/appUpdate.ts).
  useEffect(startUpdateChecks, []);
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
