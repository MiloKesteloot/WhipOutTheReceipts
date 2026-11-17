// Sets up the OurReceipts Discord server so it's only a place to explain
// itself: one #about channel nobody can post in, nothing else.
// Safe to run again (it updates the message instead of posting another).
//
//   node scripts/discord-setup.mjs          show what it would change
//   node scripts/discord-setup.mjs --apply  change it
//
// Needs DISCORD_BOT_TOKEN and DISCORD_GUILD_ID in .env.local (gitignored).
// The bot must already be in the server (supabase/DISCORD.md, step 2).
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ABOUT_TEXT } from '../supabase/functions/discord/messages.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(readFileSync(join(root, '.env.local'), 'utf8').split(/\r?\n/)
  .map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/)).filter(Boolean).map(m => [m[1], m[2]]))
const TOKEN = env.DISCORD_BOT_TOKEN
const GUILD = env.DISCORD_GUILD_ID
if (!TOKEN || !GUILD) { console.error('Add DISCORD_BOT_TOKEN and DISCORD_GUILD_ID to .env.local first.'); process.exit(1) }
const apply = process.argv.includes('--apply')

const P = {
  VIEW_CHANNEL: 1n << 10n, SEND_MESSAGES: 1n << 11n, READ_MESSAGE_HISTORY: 1n << 16n, ADD_REACTIONS: 1n << 6n,
  CREATE_PUBLIC_THREADS: 1n << 35n, CREATE_PRIVATE_THREADS: 1n << 36n, SEND_MESSAGES_IN_THREADS: 1n << 38n,
}
// Everyone can read #about and nothing else (no posting, reacting,
// threads, invites, voice, nicknames...)
const EVERYONE = P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY
// #about denies them outright too. A bot can only set channel permissions
// it has itself: one without reactions and threads denies just posting
// (@everyone doesn't have the rest server-wide, which keeps them off anyway).
const ABOUT_DENY = P.SEND_MESSAGES | P.SEND_MESSAGES_IN_THREADS | P.CREATE_PUBLIC_THREADS | P.CREATE_PRIVATE_THREADS | P.ADD_REACTIONS
const ABOUT_DENY_MINIMAL = P.SEND_MESSAGES
const missingPermissions = e => /"code":(50013|50001)/.test(String(e.message))

async function api(path, init = {}) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    ...init, headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  if (res.status === 204) return null
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path}: ${res.status} ${JSON.stringify(body)}`)
  return body
}
const step = async (what, fn) => {
  console.log(`${apply ? '→' : '(would)'} ${what}`)
  if (apply) return fn()
}

const me = await api('/users/@me')
const guild = await api(`/guilds/${GUILD}`)
const channels = await api(`/guilds/${GUILD}/channels`)
console.log(`Server: ${guild.name} · bot: ${me.username}\n`)

// Server settings: no welcome messages, notifications off by default
await step('turn off join messages and default notifications to mentions only', () =>
  api(`/guilds/${GUILD}`, { method: 'PATCH', body: JSON.stringify({
    system_channel_id: null, default_message_notifications: 1,
    description: 'Lets the OurReceipts bot send you notifications in your DMs.',
  }) }))

// @everyone: read only
await step('make @everyone read-only (view channels and history only)', () =>
  api(`/guilds/${GUILD}/roles/${GUILD}`, { method: 'PATCH', body: JSON.stringify({ permissions: String(EVERYONE) }) }))

// #about, and nothing else
let about = channels.find(c => c.type === 0 && c.name === 'about')
// (the bot's own role is let back in, or the deny would stop it posting too)
const botRole = guild.roles.find(r => r.tags?.bot_id === me.id)
if (!botRole) { console.error("Can't find the bot's role. Was it invited with the link in supabase/DISCORD.md?"); process.exit(1) }
const overwrites = deny => [
  { id: GUILD, type: 0, allow: String(P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY), deny: String(deny) },
  { id: botRole.id, type: 0, allow: String(P.VIEW_CHANNEL | P.SEND_MESSAGES | P.READ_MESSAGE_HISTORY | (1n << 13n)), deny: '0' },
]
// Full lock if the bot may set it, else posting only
async function withLock(fn) {
  try { return await fn(overwrites(ABOUT_DENY)) } catch (e) {
    if (!missingPermissions(e)) throw e
    console.log("  ! the bot can't deny reactions and threads in #about (it lacks them itself); denying posting only")
    return fn(overwrites(ABOUT_DENY_MINIMAL))
  }
}
if (!about) {
  about = await step('create #about (nobody can post, react or start threads)', () => withLock(ow =>
    api(`/guilds/${GUILD}/channels`, { method: 'POST', body: JSON.stringify({
      name: 'about', type: 0, topic: 'Why you are in this server', permission_overwrites: ow,
    }) })))
} else {
  await step('lock #about (nobody can post, react or start threads)', () => withLock(ow =>
    api(`/channels/${about.id}`, { method: 'PATCH', body: JSON.stringify({
      topic: 'Why you are in this server', permission_overwrites: ow, parent_id: null,
    }) })))
}
for (const c of channels.filter(c => c.id !== about?.id).sort((a, b) => (a.type === 4) - (b.type === 4))) {
  // (Voice channels need the Connect permission: without it, they're left
  // for you to delete)
  await step(`delete ${c.type === 4 ? 'category' : 'channel'} "${c.name}"`, () =>
    api(`/channels/${c.id}`, { method: 'DELETE' }).catch(e => {
      if (!missingPermissions(e)) throw e
      console.log(`  ! can't reach "${c.name}": delete it yourself in Discord (right-click → Delete Channel)`)
    }))
}

// The message: edit the bot's own if it's there, else post it; then pin it
// (pinning is its own permission: without it, it stays unpinned, which is
// fine for the only message in the channel)
const pin = id => api(`/channels/${about.id}/pins/${id}`, { method: 'PUT' }).catch(e => {
  if (!missingPermissions(e)) throw e
  console.log("  ! the bot can't pin messages; left unpinned")
})
if (about) {
  const msgs = await api(`/channels/${about.id}/messages?limit=50`)
  // (type 0: a normal message, not the "pinned a message" notice, type 6)
  const mine = msgs.find(m => m.author.id === me.id && m.type === 0)
  // Pin notices clutter a one-message channel
  for (const n of msgs.filter(m => m.type === 6)) {
    await step('remove the "pinned a message" notice', () => api(`/channels/${about.id}/messages/${n.id}`, { method: 'DELETE' }).catch(e => {
      if (!missingPermissions(e)) throw e
    }))
  }
  if (mine && mine.content === ABOUT_TEXT) console.log('  #about message is up to date')
  else if (mine) await step('update the #about message', () => api(`/channels/${about.id}/messages/${mine.id}`, { method: 'PATCH', body: JSON.stringify({ content: ABOUT_TEXT }) }))
  else await step('post the #about message', async () => {
    const posted = await api(`/channels/${about.id}/messages`, { method: 'POST', body: JSON.stringify({ content: ABOUT_TEXT }) })
    await pin(posted.id)
  })
  if (mine && !mine.pinned) await step('pin the #about message', () => pin(mine.id))
} else {
  await step('post and pin the #about message', () => {})
}

console.log(apply ? '\nDone.' : '\nNothing changed. Run again with --apply to do it.')
