# Cutover: accounts + groups

Moves production from "type your name, one shared list" to accounts and
groups. Everything below has been tested against a local copy of production.
`npm run deploy` refuses to run until step 4 is done.

Production app URL: `https://milokesteloot.github.io/WhipOutTheReceipts/`

## 1. Before the day (dashboard setup, no downtime)

1. **Email sending (required).** Supabase's built-in email only delivers to
   members of your Supabase organization, so roommates would never get their
   confirmation or password-reset emails. Connect your own email service under
   Authentication → Emails → SMTP Settings.

   Easiest option, no domain needed: Gmail with an app password.
   1. Turn on 2-Step Verification for the Google account.
   2. Create an app password at https://myaccount.google.com/apppasswords.
   3. In SMTP Settings, enter:
      - Host: `smtp.gmail.com`
      - Port: `465`
      - Username and sender email: the Gmail address
      - Password: the 16-character app password
      - Sender name: `Receipts`

   Other options:
   - Brevo: free, 300 emails a day. You verify a sender email address instead of a domain.
   - Resend: requires owning a domain.

   Fallback with no email at all: turn off "Confirm email" and have everyone
   use Google sign-in. Password reset won't work for email-and-password accounts.
2. **Email templates.** In Authentication → Emails, replace:
   - *Confirm signup* with `supabase/templates/confirmation.html`
   - *Reset password* with `supabase/templates/recovery.html`

   These links work on any device. The defaults only work in the browser
   that requested them.
3. **URLs.** In Authentication → URL Configuration:
   - Site URL: `https://milokesteloot.github.io/WhipOutTheReceipts/`
   - Redirect URLs: add `https://milokesteloot.github.io/WhipOutTheReceipts/**`
4. **Google sign-in.**
   - In Google Cloud Console, create an OAuth client (type: Web application) with authorized redirect URI
     `https://elmbfcpbjvoyxtyvdhef.supabase.co/auth/v1/callback`.
   - Paste its client ID and secret into Authentication → Sign In / Providers → Google.

## 2. Tell the roommates

The old app stops working at step 4. Afterwards everyone signs up, then opens
the invite link and taps their own name to keep their history.

## 3. Fresh backup (right before)

```sh
set -a; . ./.env.local; set +a
D=backups/$(date +%F)-cutover; mkdir -p $D
npx supabase@2.121.0 db dump --db-url "$SUPABASE_DB_URL" -f $D/schema.sql
npx supabase@2.121.0 db dump --db-url "$SUPABASE_DB_URL" -f $D/data.sql --data-only --use-copy
```

## 4. Migrate the database

```sh
# The baseline file is production's current schema; record it as already applied
npx supabase@2.121.0 migration repair --status applied 20261016000000 --db-url "$SUPABASE_DB_URL"
# Applies groups schema, data move, finalize (RLS + audit log), merge function
npx supabase@2.121.0 db push --db-url "$SUPABASE_DB_URL"
```

## 5. Deploy and claim

1. `npm run deploy`
2. Sign up on the live site.
3. Get the invite code:
   ```sh
   psql "$SUPABASE_DB_URL" -Atc "select invite_code from groups"
   ```
4. Open `…/#/join/<code>` and tap **I'm Milo**. You become the owner.
5. Share the invite link from Settings → Group.

## 6. Afterwards

- Reset the database password (Project Settings → Database). It was shared in chat.
- Delete the old shared Gemini key in Google AI Studio. It was publicly
  readable. Everyone now adds their own key in Settings → Personal.
