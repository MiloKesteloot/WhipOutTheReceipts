# Discord notifications: setup

The OurReceipts bot DMs people about receipts. Pieces:

- `supabase/migrations/20261116000000_discord_notifications.sql`: links, the outbox, the triggers that fill it, and the pg_cron job that wakes the function
- `supabase/functions/discord/`: the Edge Function (connecting, disconnecting, sending)
- `src/components/DiscordSettings.jsx`: Settings → Discord notifications
- `scripts/discord-setup.mjs`: makes the server a single read-only #about channel

Discord only lets a bot DM people it shares a server with. So connecting also adds the person to the OurReceipts server, which exists only for that.

Nothing secret goes in this repo (it's public). Secrets go in `.env.local` (gitignored) and in Supabase.

## 1. Create the Discord app

1. Go to https://discord.com/developers/applications → **New Application** → name it `OurReceipts`.
2. **General Information**: copy the **Application ID** (this is the client ID). Optionally add an icon and description.
3. **OAuth2**:
   - Copy the **Client Secret** (Reset Secret if needed).
   - **Redirects** → add `https://elmbfcpbjvoyxtyvdhef.supabase.co/functions/v1/discord/callback`.
4. **Bot**:
   - **Reset Token** → copy the bot token.
   - Turn **off** "Public Bot" (only you can add it to servers).
   - No privileged intents are needed.

## 2. Create the server and add the bot

1. In Discord: **+** → **Create My Own** → **For me and my friends** → name it `OurReceipts`. Leave the default channels; the setup script removes them.
2. Turn on Developer Mode (User Settings → Advanced). Right-click the server → **Copy Server ID** (this is the guild ID).
3. Add the bot. Open this link with your client ID filled in, and pick the OurReceipts server:

   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot&permissions=2252178040368243
   ```

   The permissions are: Create Invite (needed to add people), Kick Members (for Disconnect), Manage Server, Manage Roles, Manage Channels, View Channels, Send Messages, Manage Messages, Pin Messages, Read Message History, Add Reactions, the three thread permissions and Connect. A bot can only set channel permissions it has itself, so it needs reactions and threads to deny them in #about, and Connect to delete voice channels. It doesn't need Administrator.

## 3. Set up the server

Add these to `.env.local`:

```
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...
```

Then:

```
node scripts/discord-setup.mjs          # shows what it will change
node scripts/discord-setup.mjs --apply
```

This leaves one channel, **#about**, with a pinned message explaining why people are in the server. Nobody can post, react or make threads. Join messages are off and notifications default to mentions only.

With fewer permissions than the link above, the script still runs. It denies only posting in #about, leaves the message unpinned, and names any voice channels it couldn't delete so you can delete them yourself.

Note: everyone in the server can see the member list, so OurReceipts users with Discord connected can see each other's Discord usernames.

## 4. Supabase: function secrets and deploy

```
npx supabase@2.121.0 secrets set --project-ref elmbfcpbjvoyxtyvdhef \
  DISCORD_CLIENT_ID=... DISCORD_CLIENT_SECRET=... DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... \
  DISCORD_REDIRECT_URI=https://elmbfcpbjvoyxtyvdhef.supabase.co/functions/v1/discord/callback \
  APP_URL=https://<github-user>.github.io/WhipOutTheReceipts/ \
  DISCORD_CRON_SECRET=<a long random string>

npx supabase@2.121.0 functions deploy discord --project-ref elmbfcpbjvoyxtyvdhef --no-verify-jwt
```

`--no-verify-jwt` is needed because Discord's redirect to `/callback` has no sign-in token. The function checks sign-in itself on every route that needs it.

## 5. Supabase: migration, then tell pg_cron where the function is

Push the migration. This needs the live-updates migration (20261023000000) on prod first.

```
npx supabase@2.121.0 db push --db-url "$SUPABASE_DB_URL"
```

Then run this once in the SQL editor, using the same cron secret as above:

```sql
select vault.create_secret('https://elmbfcpbjvoyxtyvdhef.supabase.co/functions/v1/discord', 'discord_function_url');
select vault.create_secret('<the DISCORD_CRON_SECRET>', 'discord_cron_secret');
```

Until those exist, the cron job does nothing: pings are queued but not sent.

## Checking on it

- Connecting sends a welcome DM, so connecting is the quickest check that DMs work.
- What's queued or failed: `select kind, created_at, sent_at, skip_reason, attempts, last_error from notification_outbox order by id desc limit 50;`
- Function logs: Supabase dashboard → Edge Functions → discord → Logs.
- pg_cron runs: `select * from cron.job_run_details order by start_time desc limit 20;`
