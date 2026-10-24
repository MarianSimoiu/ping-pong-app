import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
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

const styles = StyleSheet.create({
  avatars: { flexDirection: 'row' },
  secondAvatar: { marginLeft: -6 },
});
