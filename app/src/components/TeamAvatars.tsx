import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { PlayerName } from '@/components/PlayerLink';
import type { Team } from '@/lib/doubles';

// A doubles team's two avatars, slightly overlapping.
export function TeamAvatars({ team }: { team: Team }) {
  return (
    <View style={styles.avatars}>
      <Avatar uri={team.members[0].avatarUrl} name={team.members[0].name} size={20} />
      <View style={styles.secondAvatar}>
        <Avatar uri={team.members[1].avatarUrl} name={team.members[1].name} size={20} />
      </View>
    </View>
  );
}

// "Ana & Ben" inside a line of text, each name opening its player's profile;
// with `meId`, the viewer is "You" ("You & Ben").
export function TeamNames({ team, meId }: { team: Team; meId?: string | null }) {
  const [a, b] = meId && team.members[1].id === meId ? [team.members[1], team.members[0]] : team.members;
  return (
    <>
      {meId && a.id === meId ? 'You' : <PlayerName playerId={a.id} name={a.name} />} &{' '}
      <PlayerName playerId={b.id} name={b.name} />
    </>
  );
}

const styles = StyleSheet.create({
  avatars: { flexDirection: 'row' },
  secondAvatar: { marginLeft: -6 },
});
