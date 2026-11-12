# Launch checklist (about 80 players)

What's left before inviting the whole club. Free tiers cover this size
comfortably; email is the only real blocker.

## Before inviting everyone

### Supabase dashboard (owner)

- [ ] **Email through Gmail**: see [Email via Gmail](#email-via-gmail-free) below.
  Without it, Supabase's built-in sender only reaches project members (about
  2 emails an hour), so most people never get their confirmation email.
- [ ] **Site URL**: Authentication → URL Configuration → Site URL
  `https://ping-pong-app-delta.vercel.app` (also add it under Redirect URLs),
  so confirmation links open the app.
- [ ] **Rate limits**: Authentication → Rate Limits → emails per hour about
  100. For launch night, also raise sign-ups/sign-ins per IP (about 30 per
  5 minutes by default) if everyone signs up on the club Wi-Fi.
- [ ] **Admin**: add yourself to `admins` (SQL in [DEPLOYMENT.md](DEPLOYMENT.md#admins)). Only admins can
      create, start, move or cancel tournaments; the database refuses anyone else.
- [ ] **Tournament kickoff**: check `select jobname, schedule from cron.job;` lists `tournament-kickoff`
      (see [DEPLOYMENT.md](DEPLOYMENT.md#tournament-kickoff)); otherwise tournaments start only when
      someone opens them after kickoff.
- [ ] **Deploy token**: when the GitHub secret `SUPABASE_ACCESS_TOKEN`
  expires, the Deploy Supabase workflow fails with "Invalid access token".
  Fix: new token at supabase.com/dashboard/account/tokens → update the secret
  → re-run the workflow.

### App changes still to build

- [ ] Search box in the opponent/partner picker (today every player is a
  button).
- [x] "Forgot password?" on the sign-in screen. It needs the email setup, and
  the Site URL / Redirect URLs above so the emailed link opens the app.
- [ ] Unique player names that players can edit.

### Data safety

- [ ] **Backups**: the free plan has none. Planned: an encrypted weekly
  backup by a GitHub Action. Decide how long to keep copies, whether to
  include photos, and how often; then add a `BACKUP_PASSPHRASE` secret.
- [ ] Free projects **pause after 7 days** without database activity (restore
  from the dashboard). The backup job's weekly run also prevents that.

## Rollout

1. Start with 10–15 players for about a week; fix what comes up.
2. Then everyone: one link (plus a QR code at the club). The app offers to
   install itself.
3. Welcome message: record matches from Home, the opponent confirms, ratings
   update. Turn on Notifications in Profile (on iPhone, add the app to the
   Home Screen first). "How ratings work" explains the rest.
4. A WhatsApp group for problems, with the admin fixing them.

## Email via Gmail (free)

Supabase keeps sending the emails itself (sign-up confirmation, password
reset); a Gmail account just carries them. Gmail allows about 500 a day.
Use a separate Gmail made for the app, not a personal one.

1. Turn on **2-Step Verification** for that Google account
   (myaccount.google.com → Security).
2. Create an **App Password** (myaccount.google.com/apppasswords), named
   "Supabase". Copy the 16 characters; Google shows them once.
3. Supabase → Authentication → Emails → **SMTP Settings** → enable custom SMTP:
   - Sender email: the Gmail address; sender name: Ping Pong
   - Host `smtp.gmail.com`, port `587`
   - Username: the Gmail address; password: the App Password (no spaces)
4. Test: tap "Forgot password?" on the sign-in screen (or sign up with a
   second address) and check the email arrives, looking in spam the first
   time. The reset link should open the app on "Choose a new password".

Changing that Google password or turning off 2-Step Verification cancels the
App Password: make a new one and update it in Supabase. If emails stop, look
for a Google security alert in that inbox.

## Later

- Admin "Delete match" button. Until then, wrong matches are deleted with
  [`supabase/scripts/remove_matches.sql`](../supabase/scripts/remove_matches.sql)
  in the SQL Editor (it recalculates ratings; instructions at the top).
- Pending matches that expire, or remind the opponent.
- A short privacy note (email, name, photo, matches are stored), and deleting
  accounts on request.
