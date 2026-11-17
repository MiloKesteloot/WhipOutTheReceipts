// The Discord Edge Function end to end, against a fake Discord: connecting
// (and its failures), sending what's queued, skipping what's stale, DMs
// that can't be delivered, reminders, pg_cron waking it, disconnecting.
// Nothing reaches the real Discord.
//
//   npm run ui:start && npm run ui:reset   (the UI-testing stack)
//   npm run test:e2e:discord
//
// It runs the function with `supabase functions serve` itself, and leaves
// no Discord links, queued rows or Vault secrets behind.
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { cpSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'http://127.0.0.1:54421'
const FN = `${API}/functions/v1/discord`
const DB_URL = 'postgresql://postgres:postgres@host.docker.internal:54422/postgres'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const APP_URL = 'http://localhost:5180/WhipOutTheReceipts/'
const CRON_SECRET = 'test-cron-secret'
const FAKE_PORT = 54499
const GUILD = 'guild-1'
const GROUP = "(select id from groups where invite_code = '348U9RQ5')"

const psql = statement => execFileSync('docker', ['run', '--rm', 'postgres:17-alpine', 'psql', DB_URL, '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', statement],
  { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } }).trim()

let failed = 0, passed = 0
function check(ok, what) {
  if (ok) { passed++; console.log(`ok - ${what}`) } else { failed++; console.log(`FAILED - ${what}`) }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── Fake Discord ────────────────────────────────────────────────
const USERS = { milo: { id: '2001', username: 'milo_d' }, alex: { id: '2002', username: 'alex_d' }, full: { id: '2009', username: 'full_d' } }
const fake = { joined: [], left: [], dms: [], blocked: new Set() }
const server = createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(data === undefined ? '' : JSON.stringify(data)) }
  const url = new URL(req.url, 'http://x')
  const path = url.pathname
  const auth = req.headers.authorization || ''
  let m
  if (req.method === 'POST' && path === '/oauth2/token') {
    const code = new URLSearchParams(body).get('code')
    return USERS[code] ? send(200, { access_token: `tok-${code}`, token_type: 'Bearer' }) : send(400, { error: 'invalid_grant' })
  }
  if (req.method === 'GET' && path === '/users/@me') {
    if (auth.startsWith('Bearer tok-')) return send(200, USERS[auth.slice(11)])
    return send(200, { id: 'bot', username: 'OurReceipts' })
  }
  if ((m = path.match(/^\/guilds\/([^/]+)\/members\/([^/]+)$/))) {
    if (m[1] !== GUILD) return send(404, { code: 10004, message: 'Unknown Guild' })
    if (req.method === 'PUT') {
      if (m[2] === '2009') return send(400, { code: 30001, message: 'Maximum number of guilds reached' })
      fake.joined.push({ id: m[2], token: JSON.parse(body).access_token }); return send(201, {})
    }
    if (req.method === 'DELETE') { fake.left.push(m[2]); return send(204) }
  }
  if (req.method === 'POST' && path === '/users/@me/channels') return send(200, { id: `dm-${JSON.parse(body).recipient_id}` })
  if ((m = path.match(/^\/channels\/dm-([^/]+)\/messages$/)) && req.method === 'POST') {
    if (!auth.startsWith('Bot ')) return send(401, { code: 0, message: 'Unauthorized' })
    if (fake.blocked.has(m[1])) return send(403, { code: 50007, message: 'Cannot send messages to this user' })
    fake.dms.push({ to: m[1], ...JSON.parse(body) }); return send(200, { id: String(fake.dms.length) })
  }
  send(404, { code: 0, message: `fake: no route ${req.method} ${path}` })
})
await new Promise(r => server.listen(FAKE_PORT, '0.0.0.0', r))
const dmsTo = id => fake.dms.filter(d => d.to === id)
// All the text in a DM, wherever Discord puts it (plain, embed, card)
function textOf(body) {
  const out = []
  const walk = x => {
    if (Array.isArray(x)) return x.forEach(walk)
    if (x && typeof x === 'object') {
      for (const k of ['content', 'name', 'value', 'title', 'label']) if (typeof x[k] === 'string') out.push(x[k])
      Object.values(x).forEach(walk)
    }
  }
  walk(body)
  return out.join('\n')
}

// ── The function, served locally ────────────────────────────────
const work = join(root, '.supabase-ui')
rmSync(join(work, 'supabase', 'functions'), { recursive: true, force: true })
cpSync(join(root, 'supabase', 'functions'), join(work, 'supabase', 'functions'), { recursive: true })
const envFile = join(work, 'discord-test.env')
writeFileSync(envFile, [
  'DISCORD_CLIENT_ID=client-1', 'DISCORD_CLIENT_SECRET=secret-1', 'DISCORD_BOT_TOKEN=bot-token-1', `DISCORD_GUILD_ID=${GUILD}`,
  `DISCORD_REDIRECT_URI=${FN}/callback`, `APP_URL=${APP_URL}`, `DISCORD_CRON_SECRET=${CRON_SECRET}`,
  `DISCORD_API_BASE=http://host.docker.internal:${FAKE_PORT}`,
].join('\n') + '\n')
const serve = spawn('npx --yes supabase@2.121.0 functions serve --workdir .supabase-ui --env-file .supabase-ui/discord-test.env --no-verify-jwt',
  { cwd: root, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
let serveLog = ''
serve.stdout.on('data', d => { serveLog += d }); serve.stderr.on('data', d => { serveLog += d })

let ready = false
for (let i = 0; i < 90 && !ready; i++) {
  await sleep(1000)
  ready = await fetch(`${FN}/nope`, { method: 'POST' }).then(r => r.status === 404).catch(() => false)
}
if (!ready) { console.error('The function never came up:\n' + serveLog); process.exit(1) }

// ── Helpers ─────────────────────────────────────────────────────
function cleanup() {
  psql(`delete from discord_links; delete from notification_outbox;
        delete from vault.secrets where name in ('discord_function_url', 'discord_cron_secret');
        delete from receipts where store_name like 'Discord e2e%';`)
}
cleanup()

async function signIn(email) {
  const client = createClient(API, ANON, { auth: { persistSession: false } })
  const { data, error } = await client.auth.signInWithPassword({ email, password: 'test1234' })
  if (error) throw error
  return { client, jwt: data.session.access_token, userId: data.user.id }
}
const milo = await signIn('milo@test.local')
const alex = await signIn('alex@test.local')

const call = (path, { jwt, body, headers } = {}) => fetch(`${FN}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}), ...headers },
  body: JSON.stringify(body || {}),
})
async function startState(user, timeZone = 'Europe/Paris') {
  const res = await call('/start', { jwt: user.jwt, body: { timeZone } })
  const { url } = await res.json()
  return new URL(url).searchParams.get('state')
}
const callback = async query => {
  const res = await fetch(`${FN}/callback?${new URLSearchParams(query)}`, { redirect: 'manual' })
  return { status: res.status, location: res.headers.get('location') || '' }
}
const link = userId => psql(`select coalesce((select row_to_json(d)::text from discord_links d where user_id = '${userId}'), '')`)
const linkOf = userId => { const s = link(userId); return s ? JSON.parse(s) : null }
const sendNow = (body = {}) => call('/send', { body, headers: { 'x-cron-secret': CRON_SECRET } }).then(r => r.json())
const makeDue = () => psql(`update notification_outbox set send_after = now() - interval '1 second' where sent_at is null`)
const memberId = email => `(select id from group_members where group_id = ${GROUP} and user_id = (select id from auth.users where email = '${email}'))`
async function newReceipt(user, name, extra = {}) {
  const gid = psql(`select id from groups where invite_code = '348U9RQ5'`)
  const paid = psql(`select ${memberId(user === milo ? 'milo@test.local' : 'alex@test.local')}`)
  const { data, error } = await user.client.rpc('save_receipt', { p_group: gid, p_receipt: null, p_version: null, p_data: {
    store_name: name, paid_by_member: paid, tax: 0, tip: 0, fees: 0, member_ids: [],
    items: [{ id: null, name: 'Eggs', price: 4, position: 0 }, { id: null, name: 'Milk', price: 5.5, position: 1 }], ...extra,
  } })
  if (error) throw error
  return data.id
}

try {
  // ── Connecting ────────────────────────────────────────────────
  check((await call('/start')).status === 401, 'connecting needs you signed in');

  {
    const res = await call('/start', { jwt: milo.jwt, body: { timeZone: 'Europe/Paris' } })
    const { url } = await res.json()
    const u = new URL(url)
    check(u.origin === 'https://discord.com' && u.searchParams.get('client_id') === 'client-1'
      && u.searchParams.get('scope') === 'identify guilds.join' && u.searchParams.get('redirect_uri') === `${FN}/callback`,
      "start sends you to Discord's Authorize page, asking to know who you are and to add you to the server")
  }

  {
    const r = await callback({ code: 'milo', state: await startState(milo) })
    check(r.status === 302 && r.location === `${APP_URL}#/settings?discord=connected`, 'coming back from Discord lands on Settings, connected')
    const l = linkOf(milo.userId)
    check(l?.discord_id === '2001' && l.discord_username === 'milo_d' && l.time_zone === 'Europe/Paris', 'the link is saved, with your time zone')
    check(fake.joined.some(j => j.id === '2001' && j.token === 'tok-milo'), 'you were added to the OurReceipts server (with your own permission)')
    check(dmsTo('2001').length === 1 && dmsTo('2001')[0].content.includes("You're connected"), 'the bot says hi in your DMs')
    check(l.notify_new_receipt && l.notify_items_added && l.notify_price_up && !l.notify_payment && l.remind_every_days === 1,
      'defaults: new receipts, items added and prices on; payments off; reminders every day')
  }

  {
    const r = await callback({ code: 'alex', state: await startState(alex, 'Not/AZone') })
    check(r.location.endsWith('discord=connected') && linkOf(alex.userId)?.time_zone === 'America/Los_Angeles',
      'an unknown time zone from the browser still connects (with the default zone)')
  }

  {
    const state = await startState(milo)
    const [data] = state.split('.')
    const forged = `${Buffer.from(JSON.stringify({ u: alex.userId, exp: Date.now() + 60000 })).toString('base64url')}.${state.split('.')[1]}`
    const r = await callback({ code: 'milo', state: forged })
    check(r.location.endsWith('discord=error&reason=expired') && data, "a forged state (someone else's account) is refused")
    check(linkOf(alex.userId)?.discord_id === '2002', "…and Alex's link is untouched")
  }

  {
    const expired = `${Buffer.from(JSON.stringify({ u: milo.userId, exp: Date.now() - 1 })).toString('base64url')}.x`
    check((await callback({ code: 'milo', state: expired })).location.endsWith('reason=expired'), 'an old or unsigned state is refused')
    check((await callback({ error: 'access_denied', state: 'x' })).location.endsWith('discord=cancelled'), 'pressing Cancel on Discord comes back as cancelled')
    check((await callback({ code: 'nobody', state: await startState(milo) })).location.endsWith('reason=login'), 'a bad login code comes back as a login error')
    const r = await callback({ code: 'full', state: await startState(milo) })
    check(r.location.endsWith('reason=too_many_servers'), 'someone in 200 servers is told why they could not join')
    check(linkOf(milo.userId)?.discord_id === '2001', "…and Milo's existing link is untouched")
  }

  {
    // Alex connects Milo's Discord account: it moves to Alex
    await callback({ code: 'milo', state: await startState(alex) })
    check(linkOf(alex.userId)?.discord_id === '2001' && !linkOf(milo.userId), 'one Discord account belongs to one OurReceipts account (the latest)')
    await callback({ code: 'alex', state: await startState(alex) })
    await callback({ code: 'milo', state: await startState(milo) })
    check(linkOf(alex.userId)?.discord_id === '2002' && linkOf(milo.userId)?.discord_id === '2001', '(and back)')
  }

  // ── Sending ───────────────────────────────────────────────────
  check((await call('/send', { headers: { 'x-cron-secret': 'wrong' } })).status === 403, 'only pg_cron (with the secret) can trigger sending');
  check((await call('/send', { jwt: milo.jwt })).status === 403, '…not a signed-in user');

  {
    const before = dmsTo('2002').length
    const miloBefore = dmsTo('2001').length
    const rid = await newReceipt(milo, 'Discord e2e Safeway')
    let out = await sendNow()
    check(out.sent === 0 && dmsTo('2002').length === before, 'nothing goes out in the first minute')
    makeDue()
    out = await sendNow()
    const dm = dmsTo('2002').at(-1)
    check(out.sent === 1 && dmsTo('2002').length === before + 1, 'then Alex gets one DM')
    const t = textOf(dm)
    check(t.includes('### Discord e2e Safeway\nMilo added a receipt') && t.includes('## $9.50') && t.includes('Paid by Milo'),
      'a card saying who added what, who paid and the total')
    check(/Eggs\s+4\.00\nMilk\s+5\.50/.test(t), 'listing the items (everything is the default)')
    check(JSON.stringify(dm).includes(`"url":"${APP_URL}#/receipt/${rid}"`), 'with a button that opens the receipt')
    check(JSON.stringify(dm).includes(`${APP_URL}icon-192.png`), 'and the app icon')
    check(JSON.stringify(dm?.allowed_mentions) === '{"parse":[]}', 'and it can never ping @everyone')
    check(dmsTo('2001').length === miloBefore, 'Milo (who added it) gets nothing')
    check(psql(`select count(*) from notification_outbox where receipt_id = '${rid}' and sent_at is not null and skip_reason is null`) === '1', 'the row is marked sent')
    check((await sendNow()).sent === 0, 'and is not sent twice')
  }

  {
    // Minimal, then none (Alex's setting)
    await alex.client.from('discord_links').update({ detail: 'minimal' }).eq('user_id', alex.userId)
    const rid = await newReceipt(milo, 'Discord e2e Minimal')
    makeDue(); await sendNow()
    const e = dmsTo('2002').at(-1).embeds?.[0]
    check(e?.title === 'Discord e2e Minimal · $9.50' && e.url === `${APP_URL}#/receipt/${rid}` && !textOf(dmsTo('2002').at(-1)).includes('Eggs'),
      'Alex chose minimal: a compact card without the items')
    await alex.client.from('discord_links').update({ detail: 'none' }).eq('user_id', alex.userId)
    const rid2 = await newReceipt(milo, 'Discord e2e None')
    makeDue(); await sendNow()
    const dm = dmsTo('2002').at(-1)
    check(dm.content === `You were added to a [receipt](${APP_URL}#/receipt/${rid2}).` && !dm.embeds && !dm.components,
      'Alex chose none: one line with a link')
    await alex.client.from('discord_links').update({ detail: 'everything' }).eq('user_id', alex.userId)
  }

  {
    const before = dmsTo('2002').length
    const rid = await newReceipt(milo, 'Discord e2e Oops')
    await milo.client.from('receipts').update({ deleted_at: new Date().toISOString() }).eq('id', rid)
    makeDue()
    const out = await sendNow()
    check(out.skipped === 1 && dmsTo('2002').length === before, 'a receipt deleted within the minute pings nobody')
    check(psql(`select skip_reason from notification_outbox where receipt_id = '${rid}'`) === 'receipt deleted', '…and says why')
  }

  {
    psql(`update discord_links set notify_new_receipt = false where user_id = '${alex.userId}'`)
    const before = dmsTo('2002').length
    await newReceipt(milo, 'Discord e2e Muted')
    makeDue()
    const out = await sendNow()
    check(out.skipped === 1 && dmsTo('2002').length === before, 'turned off in Settings: not sent')
    psql(`update discord_links set notify_new_receipt = true where user_id = '${alex.userId}'`)
  }

  {
    // Alex checks Eggs off and checks in, then Milo raises its price and adds bread
    const rid = await newReceipt(milo, 'Discord e2e Edits')
    makeDue(); await sendNow()
    const eggs = psql(`select id from items where receipt_id = '${rid}' and name = 'Eggs'`)
    const milk = psql(`select id from items where receipt_id = '${rid}' and name = 'Milk'`)
    const alexMember = psql(`select ${memberId('alex@test.local')}`)
    await alex.client.from('claims').insert({ item_id: eggs, member_id: alexMember })
    await alex.client.from('checkins').insert({ receipt_id: rid, member_id: alexMember })
    const version = Number(psql(`select version from receipts where id = '${rid}'`))
    const gid = psql(`select id from groups where invite_code = '348U9RQ5'`)
    const paid = psql(`select ${memberId('milo@test.local')}`)
    const { error } = await milo.client.rpc('save_receipt', { p_group: gid, p_receipt: rid, p_version: version, p_data: {
      store_name: 'Discord e2e Edits', paid_by_member: paid, tax: 0, tip: 0, fees: 0, member_ids: [],
      items: [{ id: eggs, name: 'Eggs', price: 4.75, position: 0 }, { id: milk, name: 'Milk', price: 5.5, position: 1 },
              { id: null, name: 'Bread', price: 3, position: 2 }],
    } })
    check(!error, 'Milo edits the receipt')
    const before = dmsTo('2002').length
    makeDue()
    const out = await sendNow()
    const got = dmsTo('2002').slice(before).map(d => d.content)
    check(out.sent === 2 && got.length === 2, 'Alex gets two DMs: one for the added item, one for the price')
    check(got.some(c => c.includes('**Milo** added Bread to **Discord e2e Edits**') && c.includes('Check in again')), '"Milo added Bread… check in again"')
    check(got.some(c => c.includes('Eggs: $4.00 → $4.75')), '"Eggs: $4.00 → $4.75"')
  }

  // ── Can't DM ──────────────────────────────────────────────────
  {
    fake.blocked.add('2002')
    await newReceipt(milo, 'Discord e2e Blocked')
    makeDue()
    const out = await sendNow()
    check(out.skipped === 1 && out.failed === 0, "Alex has DMs off: the ping is skipped, not retried forever")
    check(!!linkOf(alex.userId).broken_at, '…and Settings will say the bot cannot message Alex')
    await newReceipt(milo, 'Discord e2e Blocked again')
    makeDue()
    const again = await sendNow()
    check(again.skipped === 1 && again.sent === 0, "while it can't, later pings are skipped without trying")
    fake.blocked.delete('2002')
    const r = await callback({ code: 'alex', state: await startState(alex) })
    check(r.location.endsWith('discord=connected') && !linkOf(alex.userId).broken_at, 'connecting again clears the warning')
    check(dmsTo('2002').at(-1).content.includes("You're connected"), '…and the welcome arrives')
  }

  // ── Reminders ─────────────────────────────────────────────────
  {
    const rid = await newReceipt(milo, 'Discord e2e Waiting')
    psql(`update notification_outbox set sent_at = now() where receipt_id = '${rid}';
          update receipts set created_at = now() - interval '2 days' where id = '${rid}';
          update discord_links set remind_hour = extract(hour from now() at time zone 'America/Los_Angeles')::int,
            time_zone = 'America/Los_Angeles', last_reminded_at = null where user_id = '${alex.userId}';
          update discord_links set remind_every_days = 0 where user_id = '${milo.userId}';`)
    const before = dmsTo('2002').length
    check((await sendNow()).reminded === 0, 'reminders only go out on the hourly run')
    const out = await sendNow({ reminders: true })
    const dm = dmsTo('2002').at(-1)
    check(out.reminded === 1 && dmsTo('2002').length === before + 1, 'the hourly run reminds Alex')
    check(dm.content.includes('waiting on you') && dm.content.includes(`[Discord e2e Waiting](${APP_URL}#/receipt/${rid})`), 'listing the receipt with a link')
    check(!!linkOf(alex.userId).last_reminded_at, 'and remembers when')
    check((await sendNow({ reminders: true })).reminded === 0, 'not again an hour later')
  }

  // ── pg_cron wakes the function ────────────────────────────────
  {
    psql(`select vault.create_secret('http://host.docker.internal:54421/functions/v1/discord', 'discord_function_url');
          select vault.create_secret('${CRON_SECRET}', 'discord_cron_secret');`)
    const before = dmsTo('2002').length
    await newReceipt(milo, 'Discord e2e Cron')
    makeDue()
    psql('select discord_wake()')
    let arrived = false
    for (let i = 0; i < 20 && !arrived; i++) { await sleep(500); arrived = dmsTo('2002').length > before }
    check(arrived && textOf(dmsTo('2002').at(-1)).includes('Discord e2e Cron'), 'the database wakes the function, and the DM goes out')
    psql(`delete from vault.secrets where name in ('discord_function_url', 'discord_cron_secret')`)
  }

  // ── Disconnecting ─────────────────────────────────────────────
  {
    check((await call('/disconnect')).status === 401, 'disconnecting needs you signed in')
    const res = await call('/disconnect', { jwt: alex.jwt })
    check(res.status === 200 && !linkOf(alex.userId), "Disconnect forgets Alex's link")
    check(fake.left.includes('2002'), '…and takes Alex out of the server')
    const before = dmsTo('2002').length
    await newReceipt(milo, 'Discord e2e After')
    makeDue(); await sendNow()
    check(dmsTo('2002').length === before, 'and nothing more is sent to Alex')
    check((await call('/test', { jwt: alex.jwt })).status === 404, 'there is no test-message route anymore')
  }
} catch (e) {
  failed++
  console.error(e)
  console.error(serveLog.slice(-3000))
} finally {
  cleanup()
  serve.kill()
  if (process.platform === 'win32') { try { execFileSync('taskkill', ['/pid', String(serve.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {} }
  rmSync(envFile, { force: true })
  server.close()
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
