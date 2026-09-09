import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/context/AuthContext';
import { fetchMyProfile } from '@/lib/players';
import type { PlayerWithRating } from '@/lib/types';
import { colors, radius, spacing } from '@/theme';

export function HomeScreen() {
  const { session } = useAuth();
  const [profile, setProfile] = useState<PlayerWithRating | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      setError(null);
      const p = await fetchMyProfile(session.user.id);
      setProfile(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const rating = profile?.rating;
  const isProvisional = (rating?.matches_played ?? 0) < 10;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.text} />}
      >
        <Text style={styles.greeting}>
          Hi, {profile?.display_name ?? '…'} 👋
        </Text>

        {loading && !profile ? (
          <ActivityIndicator color={colors.text} style={{ marginTop: spacing.xl }} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <View style={styles.ratingCard}>
            <Text style={styles.ratingLabel}>Skill rating (Glicko-2)</Text>
            <Text style={styles.ratingValue}>{Math.round(rating?.rating ?? 1500)}</Text>
            <Text style={styles.ratingMeta}>
              ± {Math.round(rating?.rd ?? 350)} · {rating?.matches_played ?? 0} matches
              {isProvisional ? ' · provisional' : ''}
            </Text>
          </View>
        )}

        <View style={styles.hintCard}>
          <Text style={styles.hintTitle}>Coming next</Text>
          <Text style={styles.hintText}>
            Submitting matches and the rating engine land in Phase 2. Your rating
            starts at 1500 with a wide ±350 confidence band until you play.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  greeting: { fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: spacing.lg },
  ratingCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  ratingLabel: { color: colors.textMuted, fontSize: 14 },
  ratingValue: { color: colors.primary, fontSize: 56, fontWeight: '800', marginVertical: spacing.xs },
  ratingMeta: { color: colors.textMuted, fontSize: 13 },
  hintCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hintTitle: { color: colors.text, fontWeight: '600', marginBottom: spacing.xs },
  hintText: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, marginTop: spacing.lg },
});
