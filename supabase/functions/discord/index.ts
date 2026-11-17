// The OurReceipts Discord bot: connecting your Discord, and sending DMs.
// Setup and secrets: supabase/DISCORD.md.
//
//   POST /start       (signed in) → { url }: Discord's "Authorize" page
//   GET  /callback    Discord sends you back here: saves your link, adds you
//                     to the OurReceipts server (bots can only DM people they
//                     share a server with), says hi, and sends you back to
//                     Settings
//   POST /disconnect  (signed in) forget your link, leave the server
//   POST /send        (pg_cron, x-cron-secret) send what's due in
//                     notification_outbox; { reminders: true } on the hour
//
// JWTs are checked here, not by the platform (config.toml verify_jwt =
// false), because Discord's redirect to /callback has none.
import { createClient } from 'npm:@supabase/supabase-js@2.49.1'
import * as msg from './messages.js'
import { planSends } from './plan.js'

const env = (k: string) => Deno.env.get(k) ?? ''
const CLIENT_ID = env('DISCORD_CLIENT_ID')
const CLIENT_SECRET = env('DISCORD_CLIENT_SECRET')
const BOT_TOKEN = env('DISCORD_BOT_TOKEN')
const GUILD_ID = env('DISCORD_GUILD_ID')
const REDIRECT_URI = env('DISCORD_REDIRECT_URI') // this function's public URL + /callback
const APP_URL = env('APP_URL') // e.g. https://<user>.github.io/WhipOutTheReceipts/
const CRON_SECRET = env('DISCORD_CRON_SECRET')
const API = Deno.env.get('DISCORD_API_BASE') ?? 'https://discord.com/api/v10' // tests point this at a fake

const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const back = (query: string) => Response.redirect(`${APP_URL.replace(/\/+$/, '')}/#/settings?${query}`, 302)

// ── Discord API ─────────────────────────────────────────────────
class DiscordError extends Error {
  constructor(public status: number, public code: number | null, message: string) { super(message) }
}
// Can't DM them: they left the server, blocked DMs from it, or are gone
const UNREACHABLE = new Set([50007, 10013, 50278])

async function discord(path: string, init: RequestInit & { auth?: string } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(API + path, {
      ...init,
      headers: { Authorization: init.auth ?? `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
    if (res.status === 429) {
      const j = await res.json().catch(() => ({}))
      await new Promise(r => setTimeout(r, Math.min(Number(j.retry_after ?? 1), 10) * 1000))
      continue
    }
    const body = res.status === 204 ? null : await res.json().catch(() => null)
    if (!res.ok) throw new DiscordError(res.status, body?.code ?? null, body?.message ?? `HTTP ${res.status}`)
    return body
  }
  throw new DiscordError(429, null, 'Rate limited by Discord')
}

const dmChannels = new Map<string, string>()
async function sendDM(discordId: string, body: Record<string, unknown>) {
  let channel = dmChannels.get(discordId)
  if (!channel) {
    channel = (await discord('/users/@me/channels', { method: 'POST', body: JSON.stringify({ recipient_id: discordId }) })).id as string
    dmChannels.set(discordId, channel)
  }
  await discord(`/channels/${channel}/messages`, { method: 'POST', body: JSON.stringify({ ...body, allowed_mentions: { parse: [] } }) })
}

// ── Signed-in user ──────────────────────────────────────────────
async function userFrom(req: Request) {
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer /, '')
  if (!jwt) return null
  const { data } = await db.auth.getUser(jwt)
  return data.user ?? null
}

// ── OAuth state: who's connecting, signed so it can't be forged ──
const enc = new TextEncoder()
const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
async function hmac(data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(CLIENT_SECRET + ':state'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)))
}
async function makeState(payload: Record<string, unknown>) {
  const data = b64url(enc.encode(JSON.stringify(payload)))
  return `${data}.${await hmac(data)}`
}
async function readState(state: string) {
  const [data, sig] = state.split('.')
  if (!data || !sig || sig !== await hmac(data)) return null
  const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(data.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))))
  return payload.exp > Date.now() ? payload : null
}

// ── Routes ──────────────────────────────────────────────────────
async function start(req: Request) {
  const user = await userFrom(req)
  if (!user) return json({ error: 'Not signed in' }, 401)
  const { timeZone } = await req.json().catch(() => ({}))
  const state = await makeState({ u: user.id, tz: typeof timeZone === 'string' ? timeZone.slice(0, 64) : null, exp: Date.now() + 15 * 60 * 1000 })
  const url = new URL('https://discord.com/oauth2/authorize')
  url.search = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
    scope: 'identify guilds.join', state, prompt: 'consent',
  }).toString()
  return json({ url: url.toString() })
}

async function callback(url: URL) {
  if (url.searchParams.get('error')) return back('discord=cancelled')
  const state = await readState(url.searchParams.get('state') ?? '')
  const code = url.searchParams.get('code')
  if (!state || !code) return back('discord=error&reason=expired')

  // Code → access token → who they are on Discord
  const tokenRes = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  })
  if (!tokenRes.ok) return back('discord=error&reason=login')
  const { access_token } = await tokenRes.json()
  let me
  try { me = await discord('/users/@me', { auth: `Bearer ${access_token}` }) } catch { return back('discord=error&reason=login') }

  // Into the server (201 added, 204 already there)
  try {
    await discord(`/guilds/${GUILD_ID}/members/${me.id}`, { method: 'PUT', body: JSON.stringify({ access_token }) })
  } catch (e) {
    const reason = e instanceof DiscordError && e.code === 30001 ? 'too_many_servers' : 'server'
    return back(`discord=error&reason=${reason}`)
  }

  // One Discord account belongs to one OurReceipts account: connecting it
  // here takes it off any other
  await db.from('discord_links').delete().eq('discord_id', me.id).neq('user_id', state.u)
  const row = { user_id: state.u, discord_id: me.id, discord_username: me.username, broken_at: null, linked_at: new Date().toISOString() }
  let { error } = await db.from('discord_links').upsert(state.tz ? { ...row, time_zone: state.tz } : row, { onConflict: 'user_id' })
  if (error && state.tz) ({ error } = await db.from('discord_links').upsert(row, { onConflict: 'user_id' })) // unknown time zone
  if (error) return back('discord=error&reason=save')

  try { await sendDM(me.id, msg.welcome({ appUrl: APP_URL })) } catch { /* they're connected; a welcome isn't worth failing over */ }
  return back('discord=connected')
}

async function disconnect(req: Request) {
  const user = await userFrom(req)
  if (!user) return json({ error: 'Not signed in' }, 401)
  const { data: link } = await db.from('discord_links').select('discord_id').eq('user_id', user.id).maybeSingle()
  if (link) {
    try { await discord(`/guilds/${GUILD_ID}/members/${link.discord_id}`, { method: 'DELETE' }) } catch { /* already gone */ }
    await db.from('discord_links').delete().eq('user_id', user.id)
  }
  return json({ ok: true })
}

// ── Sending ─────────────────────────────────────────────────────
const inList = <T>(xs: T[]) => [...new Set(xs.filter(x => x != null))]

async function loadContext(rows: Array<Record<string, any>>) {
  const userIds = inList(rows.map(r => r.user_id))
  const noticeIds = inList(rows.map(r => r.notice_id))
  const paymentIds = inList(rows.map(r => r.payment_id))

  const [{ data: links }, { data: notices }, { data: payments }] = await Promise.all([
    db.from('discord_links').select('*').in('user_id', userIds),
    db.from('receipt_notices').select('id, kind, item_id, old_price, new_price, seen_at, items(name)').in('id', noticeIds),
    db.from('payments').select('id, group_id, from_member, to_member, amount, note, receipt_id, deleted_at').in('id', paymentIds),
  ])
  const receiptIds = inList([...rows.map(r => r.receipt_id), ...(payments ?? []).map(p => p.receipt_id)])
  const [{ data: receipts }, { data: items }, { data: checkins }] = await Promise.all([
    db.from('receipts').select('id, group_id, store_name, receipt_date, deleted_at, member_ids, paid_by_member, tax, tip, fees').in('id', receiptIds),
    db.from('items').select('receipt_id, name, price, position').in('receipt_id', receiptIds).is('deleted_at', null).order('position'),
    db.from('checkins').select('receipt_id, member_id').in('receipt_id', receiptIds),
  ])
  const groupIds = inList([...(receipts ?? []).map(r => r.group_id), ...(payments ?? []).map(p => p.group_id)])
  const { data: members } = await db.from('group_members').select('id, group_id, user_id, first_name, active').in('group_id', groupIds)

  const totals = new Map<string, number>()
  const itemsOf = new Map<string, Array<{ name: string, price: number }>>()
  for (const i of items ?? []) {
    totals.set(i.receipt_id, (totals.get(i.receipt_id) ?? 0) + Number(i.price))
    if (!itemsOf.has(i.receipt_id)) itemsOf.set(i.receipt_id, [])
    itemsOf.get(i.receipt_id)!.push({ name: i.name, price: Number(i.price) })
  }
  return {
    appUrl: APP_URL,
    links: new Map((links ?? []).map(l => [l.user_id, l])),
    receipts: new Map((receipts ?? []).map(r => [r.id, { ...r, items: itemsOf.get(r.id) ?? [], total: (totals.get(r.id) ?? 0) + Number(r.tax) + Number(r.tip) + Number(r.fees) }])),
    members: new Map((members ?? []).map(m => [m.id, m])),
    checkins: new Set((checkins ?? []).map(c => `${c.receipt_id}:${c.member_id}`)),
    notices: new Map((notices ?? []).map(n => [n.id, { ...n, item_name: (n as any).items?.name ?? null }])),
    payments: new Map((payments ?? []).map(p => [p.id, p])),
  }
}

async function markBroken(userId: string) {
  await db.from('discord_links').update({ broken_at: new Date().toISOString() }).eq('user_id', userId)
}

async function send(req: Request) {
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return json({ error: 'Forbidden' }, 403)
  const { reminders } = await req.json().catch(() => ({}))
  const result = { sent: 0, skipped: 0, failed: 0, reminded: 0 }

  // Queued pings, a batch at a time
  for (let round = 0; round < 5; round++) {
    const { data: rows, error } = await db.rpc('discord_claim_due', { p_limit: 100 })
    if (error) throw error
    if (!rows?.length) break
    const { sends, skips } = planSends(rows, await loadContext(rows))
    for (const s of skips) {
      await db.rpc('discord_finish', { p_ids: s.ids, p_skip: s.reason })
      result.skipped += s.ids.length
    }
    const broken = new Set<string>()
    for (const s of sends) {
      if (broken.has(s.userId)) {
        await db.rpc('discord_finish', { p_ids: s.ids, p_skip: "can't DM them" }); result.skipped += s.ids.length; continue
      }
      try {
        await sendDM(s.discordId, s.body)
        await db.rpc('discord_finish', { p_ids: s.ids })
        result.sent++
      } catch (e) {
        if (e instanceof DiscordError && e.code !== null && UNREACHABLE.has(e.code)) {
          broken.add(s.userId)
          await markBroken(s.userId)
          await db.rpc('discord_finish', { p_ids: s.ids, p_skip: "can't DM them" })
          result.skipped += s.ids.length
        } else {
          await db.rpc('discord_finish', { p_ids: s.ids, p_error: String((e as Error).message).slice(0, 500) })
          result.failed++
        }
      }
    }
    if (rows.length < 100) break
  }

  // Reminders (the database decides who's due)
  if (reminders) {
    const { data: due, error } = await db.rpc('discord_reminders_due')
    if (error) throw error
    const { data: details } = await db.from('discord_links').select('user_id, detail').in('user_id', (due ?? []).map(d => d.user_id))
    const detailOf = new Map((details ?? []).map(d => [d.user_id, d.detail]))
    for (const d of due ?? []) {
      try {
        await sendDM(d.discord_id, msg.reminder({ appUrl: APP_URL, receipts: d.receipts, detail: detailOf.get(d.user_id) }))
        await db.from('discord_links').update({ last_reminded_at: new Date().toISOString() }).eq('user_id', d.user_id)
        result.reminded++
      } catch (e) {
        if (e instanceof DiscordError && e.code !== null && UNREACHABLE.has(e.code)) await markBroken(d.user_id)
        else result.failed++ // tried again next hour (still within the reminder window)
      }
    }
  }
  return json(result)
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)
  const route = url.pathname.replace(/^.*\/discord/, '') || '/'
  try {
    if (req.method === 'POST' && route === '/start') return await start(req)
    if (req.method === 'GET' && route === '/callback') return await callback(url)
    if (req.method === 'POST' && route === '/disconnect') return await disconnect(req)
    if (req.method === 'POST' && route === '/send') return await send(req)
    return json({ error: 'Not found' }, 404)
  } catch (e) {
    console.error(e)
    if (route === '/callback') return back('discord=error&reason=server')
    return json({ error: 'Something went wrong' }, 500)
  }
})
