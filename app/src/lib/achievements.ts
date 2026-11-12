import * as demo from '@/lib/demo';
import { DEMO } from '@/lib/env';
import { supabase } from '@/lib/supabase';

// Titles and trophies (migration 0015): the catalog of achievements, a
// player's progress toward each, their tournament honours, and the titles
// they can show. All worked out by the database from match history.

export type Achievement = {
  code: string;
  name: string;
  description: string;
  emoji: string;
  target: number;
  sort: number;
};

export type Honour = { tournamentId: string; tournamentName: string; won: boolean; at: string };

export type EarnedTitle = { title: string; label: string; earnedAt: string };

export type Trophies = {
  catalog: Achievement[];
  progress: Record<string, { progress: number; earnedAt: string | null }>;
  honours: Honour[];
  titles: EarnedTitle[]; // every title the player can pick, earliest first
};

export async function fetchTrophies(playerId: string): Promise<Trophies> {
  if (DEMO) return demo.demoTrophies(playerId);
  const [cRes, pRes, hRes, tRes] = await Promise.all([
    supabase.from('achievements').select('code, name, description, emoji, target, sort').order('sort'),
    supabase.from('achievement_progress').select('code, progress, earned_at').eq('player_id', playerId),
    supabase
      .from('tournament_honours')
      .select('tournament_id, tournament_name, won, at')
      .eq('player_id', playerId)
      .order('at', { ascending: false }),
    supabase.from('earned_titles').select('title, label, earned_at').eq('player_id', playerId).order('earned_at'),
  ]);
  for (const r of [cRes, pRes, hRes, tRes]) if (r.error) throw r.error;
  const progress: Trophies['progress'] = {};
  for (const r of (pRes.data ?? []) as any[]) progress[r.code] = { progress: r.progress, earnedAt: r.earned_at };
  return {
    catalog: (cRes.data ?? []) as Achievement[],
    progress,
    honours: ((hRes.data ?? []) as any[]).map((h) => ({
      tournamentId: h.tournament_id,
      tournamentName: h.tournament_name,
      won: h.won,
      at: h.at,
    })),
    titles: ((tRes.data ?? []) as any[]).map((t) => ({ title: t.title, label: t.label, earnedAt: t.earned_at })),
  };
}

// Shows `title` (one of the player's earned titles) under their name, or
// none. The database refuses a title that isn't earned.
export async function setTitle(playerId: string, title: string | null): Promise<void> {
  if (DEMO) return demo.demoSetTitle(title);
  const { error } = await supabase.from('players').update({ title }).eq('id', playerId);
  if (error) throw error;
}

// The catalog alone (for How ratings work).
export async function fetchCatalog(): Promise<Achievement[]> {
  if (DEMO) return demo.demoTrophies(demo.DEMO_ME).catalog;
  const { data, error } = await supabase.from('achievements').select('code, name, description, emoji, target, sort').order('sort');
  if (error) throw error;
  return (data ?? []) as Achievement[];
}
