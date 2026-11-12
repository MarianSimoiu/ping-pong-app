import * as demo from '@/lib/demo';
import { DEMO } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import type { PlayerBadge, TierLine } from '@/lib/tiers';

// Every player's tier and markers (one row each, so one small request) and
// the tier lines.
export async function fetchBadges(): Promise<{ badges: Record<string, PlayerBadge>; lines: TierLine[] }> {
  if (DEMO) return demo.demoBadges();
  const [bRes, lRes] = await Promise.all([
    supabase
      .from('player_badges')
      .select('player_id, tier, best_tier, legend, inactive, champion_count, season_leader, title, title_label'),
    supabase.from('tier_lines').select('tier, min_rating'),
  ]);
  if (bRes.error) throw bRes.error;
  if (lRes.error) throw lRes.error;
  const badges: Record<string, PlayerBadge> = {};
  for (const r of (bRes.data ?? []) as any[]) {
    badges[r.player_id] = {
      playerId: r.player_id,
      tier: r.tier,
      bestTier: r.best_tier,
      legend: r.legend,
      inactive: r.inactive,
      championCount: r.champion_count ?? 0,
      seasonLeader: !!r.season_leader,
      title: r.title ?? null,
      titleLabel: r.title_label ?? null,
    };
  }
  const lines = ((lRes.data ?? []) as any[]).map((l) => ({ tier: l.tier, minRating: l.min_rating }));
  return { badges, lines };
}

// The signed-in user's player id.
export async function fetchMyPlayerId(userId: string): Promise<string | null> {
  if (DEMO) return demo.DEMO_ME;
  const { data, error } = await supabase.from('players').select('id').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}
