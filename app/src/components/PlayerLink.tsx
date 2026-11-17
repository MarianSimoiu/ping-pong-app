import { StackActions, useNavigation } from '@react-navigation/native';
import React, { useCallback } from 'react';
import { Pressable, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

// Tapping a player anywhere opens their profile. Every tab's stack has the
// PlayerProfile screen, so it opens on top of the current screen, in the same
// tab, and Back comes straight back (a profile from a profile stacks up too).
export function useOpenPlayer() {
  const navigation = useNavigation();
  return useCallback(
    (playerId: string, displayName?: string) =>
      navigation.dispatch(StackActions.push('PlayerProfile', { playerId, displayName })),
    [navigation],
  );
}

// A block (a photo and name, or a whole row about one player) that opens the
// player's profile. Without a player (TBD, a bye) it's just the block.
export function PlayerLink({
  playerId,
  name,
  style,
  children,
}: {
  playerId: string | null | undefined;
  name: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const open = useOpenPlayer();
  if (!playerId) return <View style={style}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => open(playerId, name)}
      style={({ pressed }) => [style, pressed && { opacity: 0.6 }]}
    >
      {children}
    </Pressable>
  );
}

// A player's name inside a line of text, opening their profile. `children`
// is what's shown when it isn't just the name ("Ana (you)").
export function PlayerName({
  playerId,
  name,
  style,
  children,
}: {
  playerId: string | null | undefined;
  name: string;
  style?: StyleProp<TextStyle>;
  children?: React.ReactNode;
}) {
  const open = useOpenPlayer();
  if (!playerId) return <Text style={style}>{children ?? name}</Text>;
  return (
    <Text accessibilityRole="link" suppressHighlighting onPress={() => open(playerId, name)} style={style}>
      {children ?? name}
    </Text>
  );
}
