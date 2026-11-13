// Edge Function: tournament-kickoff
//
// Starts every tournament whose kickoff time has come and that has at least
// 4 players: makes the draw and tells each player who they play first, and
// when. Also tells the admins about matches not played by the day after
// their date (0018). The database calls it every minute while either is due
// (migrations 0013, 0018), and the app calls it when it shows a tournament
// past its kickoff.
//
// It takes no input and only does what is already due, so it is safe for
// anyone to call: it's deployed without the user-token check
// (--no-verify-jwt, see .github/workflows/supabase-deploy.yml), since the
// database calls it without one.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { announceDraw, startTournament } from '../_shared/kickoff.ts';
import { afterResponse } from '../_shared/notify.ts';
import { announceOverdue } from '../_shared/schedule.ts';
import { errorMessage } from '../_shared/tournaments.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const { data: due, error } = await admin
      .from('tournaments')
      .select('id')
      .eq('status', 'registration')
      .lte('kickoff_at', new Date().toISOString());
    if (error) throw error;

    const started: string[] = [];
    const waiting: { id: string; reason: string }[] = [];
    for (const { id } of due ?? []) {
      try {
        const outcome = await startTournament(admin, id, null);
        if (outcome.started) started.push(id);
        else waiting.push({ id, reason: outcome.reason });
      } catch (e) {
        console.warn(`Kickoff of ${id} failed`, e);
        waiting.push({ id, reason: errorMessage(e) });
      }
    }

    if (started.length > 0) await afterResponse(Promise.all(started.map((id) => announceDraw(admin, id))));
    await afterResponse(announceOverdue(admin));
    return jsonResponse({ started, waiting });
  } catch (e) {
    return jsonResponse({ error: errorMessage(e) }, 500);
  }
});
