// Edge Function: challenge-notices
//
// Sends the weekly challenge notifications that are due (migration 0031):
// "your challenges this week" from Monday 09:00, and from Thursday 10:00 a
// reminder of the ones still open, in club time. The database calls it from
// its hourly job when something is due.
//
// It takes no input and only sends what is due, each notice once (the
// database marks them as it hands them out), so it is safe for anyone to
// call: it's deployed without the user-token check (--no-verify-jwt, see
// .github/workflows/supabase-deploy.yml), since the database calls it
// without one.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { challengesAnnounced, challengesReminder } from '../_shared/messages.ts';
import { notifyEach } from '../_shared/notify.ts';
import { errorMessage } from '../_shared/tournaments.ts';

type Notice = { player_id: string; kind: 'announce' | 'remind'; opponents: string[] };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const { data, error } = await admin.rpc('claim_challenge_notices');
    if (error) throw error;
    const notices = ((data ?? []) as Notice[]).filter((n) => n.opponents.length > 0);
    await notifyEach(
      admin,
      notices.map((n) => ({
        playerId: n.player_id,
        message: n.kind === 'announce'
          ? challengesAnnounced({ opponents: n.opponents })
          : challengesReminder({ opponents: n.opponents }),
      })),
    );
    return jsonResponse({ sent: notices.length });
  } catch (e) {
    return jsonResponse({ error: errorMessage(e) }, 500);
  }
});
