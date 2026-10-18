// Takes the portfolio screenshots of the app, the same way every run.
//
//   npm run screenshots                  reset + seed the local database, then take every shot
//   npm run screenshots -- stats tj      only the shots with these names
//   npm run screenshots -- --no-reset    keep the current local data (faster when only shots.json changed)
//
// Everything runs against the LOCAL Supabase in Docker (npx supabase start),
// never production. demo-data.json is what's in the app; shots.json is what
// gets captured and where the images go.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, copyFileSync } from 'fs'
import { tmpdir } from 'os'
import { execSync, spawn } from 'child_process'
import { dirname, join, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import { calculateDebts } from '../src/lib/splitLogic.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const SUPABASE = 'npx -y supabase@2.121.0'
const PASSWORD = 'demo-password-123'
const DB_CONTAINER = 'supabase_db_WhipOutTheReceipts'

const data = JSON.parse(readFileSync(join(here, 'demo-data.json'), 'utf8'))
const config = JSON.parse(readFileSync(join(here, 'shots.json'), 'utf8'))
const args = process.argv.slice(2)
const onlyNames = args.filter(a => !a.startsWith('--'))
const reset = !args.includes('--no-reset')

const sh = cmd => execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// ── Local Supabase ───────────────────────────────────────────
function localSupabase() {
  let status
  try { status = JSON.parse(sh(`${SUPABASE} status -o json`)) } catch {
    console.log('Starting local Supabase (Docker)…')
    sh(`${SUPABASE} start`)
    status = JSON.parse(sh(`${SUPABASE} status -o json`))
  }
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(status.API_URL)) throw new Error(`Refusing to run: ${status.API_URL} is not local`)
  return { url: status.API_URL, anonKey: status.ANON_KEY, serviceKey: status.SERVICE_ROLE_KEY }
}

// ── Demo data ────────────────────────────────────────────────
// Small seeded random generator, so the generated history is identical every run
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const today = new Date(data.today)
const dateDaysAgo = n => new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() - n)).toISOString().slice(0, 10)
const round2 = n => Math.round(n * 100) / 100

// Turn demo-data.json into a flat list of receipts with every field filled in
function buildReceipts() {
  const everyone = data.people.map(p => p.first)
  const featured = data.receipts.map(r => {
    const members = r.members || everyone
    const checkedIn = members.filter(m => !(r.notCheckedIn || []).includes(m) || m === r.paidBy)
    const item = (it, meal) => ({
      name: it.name, price: it.price, alwaysSplit: !!it.alwaysSplit, meal,
      claimedBy: (it.alwaysSplit || !it.claimedBy ? members : it.claimedBy).filter(m => checkedIn.includes(m)),
    })
    return {
      key: r.key, store: r.store, category: r.category || 'Groceries', date: dateDaysAgo(r.daysAgo),
      paidBy: r.paidBy, members, checkedIn, tax: r.tax || 0, tip: r.tip || 0, fees: r.fees || 0,
      meals: (r.meals || []).map(m => ({ name: m.name, fee: m.fee || 0 })),
      items: [
        ...(r.meals || []).flatMap(m => m.items.map(it => item(it, m.name))),
        ...r.items.map(it => item(it, null)),
      ],
      settled: r.settled || [],
    }
  })

  const h = data.history
  const random = rng(h.seed)
  const pick = list => list[Math.floor(random() * list.length)]
  const history = []
  for (const s of h.stores) {
    for (let ago = h.fromDaysAgo - Math.floor(random() * s.everyDays); ago >= h.toDaysAgo; ago -= s.everyDays) {
      const [min, max] = s.itemsPerTrip
      const count = min + Math.floor(random() * (max - min + 1))
      const pool = [...s.items].sort(() => random() - 0.5).slice(0, count)
      const items = pool.map(([name, price, alwaysSplit]) => {
        let claimedBy
        if (alwaysSplit) claimedBy = everyone
        else if (s.oneEach) claimedBy = [pick(everyone)]
        else if (random() < 0.4) claimedBy = everyone
        else claimedBy = [...new Set([pick(everyone), pick(everyone)])]
        return { name, price, alwaysSplit: !!alwaysSplit, meal: null, claimedBy }
      })
      const subtotal = items.reduce((t, i) => t + i.price, 0)
      history.push({
        key: null, store: s.store, category: s.category, date: dateDaysAgo(ago + Math.floor(random() * 3)),
        paidBy: pick(everyone), members: everyone, checkedIn: everyone,
        tax: round2(subtotal * (s.taxRate || 0)), tip: round2(subtotal * (s.tipRate || 0)), fees: 0,
        meals: [], items, settled: everyone,
      })
    }
  }
  history.sort((a, b) => a.date.localeCompare(b.date))
  return [...history, ...featured]
}

async function seed({ url, serviceKey }) {
  const db = createClient(url, serviceKey, { auth: { persistSession: false } })
  const check = ({ data, error }) => { if (error) throw new Error(error.message); return data }
  const at = (date, minutes) => new Date(Date.parse(`${date}T19:00:00Z`) + minutes * 60000).toISOString()
  // Sequential ids instead of random ones: the app breaks ties (and hands out
  // leftover cents) by id order, so random ids would change the shots each run
  let seq = 0
  const uid = () => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, '0')}`

  // Accounts (profiles are created by the database trigger from the metadata)
  const userIdOf = {}
  for (const p of data.people) {
    const { user } = check(await db.auth.admin.createUser({
      id: uid(), email: `${p.first.toLowerCase()}@example.com`, password: PASSWORD, email_confirm: true,
      user_metadata: { first_name: p.first, last_name: p.last },
    }))
    userIdOf[p.first] = user.id
  }

  const viewerId = userIdOf[data.viewer]
  const [group] = check(await db.from('groups').insert({ id: uid(), name: data.group, created_by: viewerId }).select())
  const memberRows = check(await db.from('group_members').insert(data.people.map((p, i) => ({
    id: uid(), group_id: group.id, user_id: userIdOf[p.first], first_name: p.first, last_name: p.last,
    role: p.first === data.viewer ? 'owner' : 'member', created_at: at('2026-01-01', i),
  }))).select())
  const memberIdOf = Object.fromEntries(memberRows.map(m => [m.first_name, m.id]))
  const userOfMember = name => userIdOf[name]

  const receipts = buildReceipts()
  const idByKey = {}
  for (const r of receipts) {
    const [row] = check(await db.from('receipts').insert({
      id: uid(), group_id: group.id, store_name: r.store, category: r.category, receipt_date: r.date,
      paid_by_member: memberIdOf[r.paidBy], member_ids: r.members.map(m => memberIdOf[m]),
      tax: r.tax, tip: r.tip, fees: r.fees, created_by: userOfMember(r.paidBy), created_at: at(r.date, 0),
    }).select())
    if (r.key) idByKey[r.key] = row.id

    const mealIdOf = {}
    if (r.meals.length) {
      const meals = check(await db.from('meals').insert(r.meals.map((m, i) => ({
        id: uid(), receipt_id: row.id, name: m.name, fee: m.fee, created_by: userOfMember(r.paidBy), created_at: at(r.date, i / 60),
      }))).select())
      for (const m of meals) mealIdOf[m.name] = m.id
    }
    const items = check(await db.from('items').insert(r.items.map((it, i) => ({
      id: uid(), receipt_id: row.id, name: it.name, price: it.price, always_split: it.alwaysSplit, meal_id: it.meal ? mealIdOf[it.meal] : null,
      created_by: userOfMember(r.paidBy), created_at: at(r.date, 1 + i / 60),
    }))).select())

    // Each checked-in person claims their items a little while after the receipt was added
    const claims = []
    r.items.forEach((it, i) => {
      for (const person of it.claimedBy) {
        claims.push({ id: uid(), item_id: items[i].id, member_id: memberIdOf[person], created_at: at(r.date, 30 + 45 * r.checkedIn.indexOf(person) + i / 60) })
      }
    })
    if (claims.length) check(await db.from('claims').insert(claims))
    check(await db.from('checkins').insert(r.checkedIn.map(person => ({ id: uid(), receipt_id: row.id, member_id: memberIdOf[person] }))))

    // Settled debts: paid back in full a day or two later
    if (r.settled.length) {
      // Same created_at as the stored receipt, so the app rounds it the same way
      const debts = calculateDebts(
        [{ id: 'r', paid_by: r.paidBy, tip: r.tip, tax: r.tax, fees: r.fees, created_at: at(r.date, 0) }],
        r.items.map((it, i) => ({ id: i, receipt_id: 'r', meal_id: it.meal, price: it.price })),
        r.items.flatMap((it, i) => it.claimedBy.map(roommate => ({ item_id: i, roommate }))),
        r.meals.map(m => ({ id: m.name, receipt_id: 'r', fee: m.fee })),
      ).filter(d => r.settled.includes(d.debtor))
      if (debts.length) check(await db.from('payments').insert(debts.map((d, i) => ({
        id: uid(), group_id: group.id, receipt_id: row.id, from_member: memberIdOf[d.debtor], to_member: memberIdOf[d.creditor],
        amount: d.amount, created_by: userOfMember(d.debtor), created_at: at(r.date, 1440 + 200 * i), paid_at: at(r.date, 1440 + 200 * i),
      }))))
    }
  }

  // The history log was written by triggers as "no one, right now". Make it
  // read like the people did it, when they did it.
  execSync(`docker exec -i ${DB_CONTAINER} psql -U postgres -q -v ON_ERROR_STOP=1`, { input: `
    update public.audit_log set created_at = (new_data->>'created_at')::timestamptz where new_data ? 'created_at';
    update public.audit_log a set actor = r.created_by from public.receipts r
      where a.table_name = 'receipts' and a.row_id = r.id;
    update public.audit_log a set actor = r.created_by from public.receipts r
      where a.table_name in ('items', 'meals') and (a.new_data->>'receipt_id')::uuid = r.id;
    update public.audit_log a set actor = m.user_id from public.group_members m
      where a.table_name in ('claims', 'checkins') and (a.new_data->>'member_id')::uuid = m.id;
    update public.audit_log a set actor = m.user_id, created_at = (a.new_data->>'paid_at')::timestamptz from public.group_members m
      where a.table_name = 'payments' and (a.new_data->>'from_member')::uuid = m.id;
  `, stdio: ['pipe', 'inherit', 'inherit'] })

  console.log(`Seeded ${receipts.length} receipts for ${data.people.length} people.`)
  return idByKey
}

async function receiptKeys({ url, serviceKey }) {
  // --no-reset: look the featured receipts up again by store + date
  const db = createClient(url, serviceKey, { auth: { persistSession: false } })
  const idByKey = {}
  for (const r of data.receipts) {
    const { data: rows } = await db.from('receipts').select('id').eq('store_name', r.store).eq('receipt_date', dateDaysAgo(r.daysAgo)).limit(1)
    if (rows?.[0]) idByKey[r.key] = rows[0].id
  }
  return idByKey
}

// ── App server ───────────────────────────────────────────────
// A production build pointed at the local database, in its own folder so
// dist/ (what gets deployed) is never touched.
async function startApp({ url, anonKey }) {
  const port = config.port || 5199
  if (await fetch(`http://localhost:${port}/`).then(() => true, () => false)) {
    throw new Error(`Port ${port} is already in use. Stop whatever is running there, or change "port" in shots.json.`)
  }
  const vite = join(root, 'node_modules/vite/bin/vite.js')
  const outDir = 'node_modules/.showcase-build'
  const env = { ...process.env, VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonKey }
  console.log('Building the app…')
  execSync(`"${process.execPath}" "${vite}" build --outDir ${outDir} --emptyOutDir --logLevel error`, { cwd: root, env, stdio: 'inherit' })
  const server = spawn(process.execPath, [vite, 'preview', '--outDir', outDir, '--port', String(port), '--strictPort'], {
    cwd: root, env, stdio: 'ignore',
  })
  const base = `http://localhost:${port}/WhipOutTheReceipts/`
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base)).ok) return { server, base } } catch {}
    await new Promise(r => setTimeout(r, 500))
  }
  server.kill()
  throw new Error('The app dev server did not start')
}

// ── Screenshots ──────────────────────────────────────────────
async function takeShots({ url, anonKey }, base, idByKey) {
  const auth = createClient(url, anonKey, { auth: { persistSession: false } })
  const { data: login, error } = await auth.auth.signInWithPassword({ email: `${data.viewer.toLowerCase()}@example.com`, password: PASSWORD })
  if (error) throw new Error(`Could not sign in as ${data.viewer}: ${error.message}`)
  const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`
  const viewerClient = createClient(url, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${login.session.access_token}` } } })
  const { data: me } = await viewerClient.from('group_members').select('id').eq('user_id', login.user.id).single()
  // {receiptKey} → that receipt's id, {me} → the viewer's member id (in paths and storage keys)
  const fill = (text, shotName) => text.replace(/\{(\w+)\}/g, (_, key) => {
    if (key === 'me') return me.id
    if (!idByKey[key]) throw new Error(`Shot "${shotName}": no receipt with key "${key}" in demo-data.json`)
    return idByKey[key]
  })
  const fillKeys = (obj, shotName) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [fill(k, shotName), v]))

  const outDir = resolve(here, config.outDir)
  mkdirSync(outDir, { recursive: true })
  const shots = config.shots.filter(s => !onlyNames.length || onlyNames.includes(s.name))
  const browser = await chromium.launch()
  // Headless screencasts come out at CSS pixels unless Chrome's scale is forced
  const videoBrowsers = {}
  const videoBrowser = scale => (videoBrowsers[scale] ||= chromium.launch({ args: [`--force-device-scale-factor=${scale}`] }))

  for (const shot of shots) {
    const device = { ...config.devices[shot.device], ...shot.viewport }
    const context = await (shot.video ? await videoBrowser(device.scale) : browser).newContext({
      viewport: { width: device.width, height: device.height },
      deviceScaleFactor: device.scale, isMobile: !!device.mobile, hasTouch: !!device.mobile,
      locale: 'en-US', timezoneId: config.timezone,
    })
    await context.clock.setFixedTime(new Date(data.today))
    await context.addInitScript(([key, session, local, sessionVals]) => {
      localStorage.setItem(key, JSON.stringify(session))
      for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v)
      for (const [k, v] of Object.entries(sessionVals)) sessionStorage.setItem(k, v)
    }, [storageKey, login.session, fillKeys(shot.localStorage, shot.name), fillKeys(shot.sessionStorage, shot.name)])

    const page = await context.newPage()
    page.on('pageerror', e => console.log(`  ! ${shot.name}: ${e.message}`))
    const path = fill(shot.path, shot.name)
    await page.goto(`${base}#${path}`)
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('nav', { timeout: 15000 }).catch(() => { throw new Error(`Shot "${shot.name}": the signed-in app never appeared`) })
    await page.waitForFunction(() => !document.body.innerText.includes('Loading…'))
    // Videos keep the app's transitions and show a ripple where each tap lands
    await page.addStyleTag({ content: shot.video ? TAP_RIPPLE_CSS : '*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }' })
    if (shot.video) { await page.evaluate(TAP_RIPPLE_JS); await page.evaluate(LOADING_WATCH_JS) }
    // "hide": selectors to leave out of this shot (e.g. buttons that clutter a video)
    if (shot.hide) await page.addStyleTag({ content: `${shot.hide.join(', ')} { display: none !important; }` })

    let recording
    if (shot.video) {
      await page.waitForTimeout(shot.settle ?? 1200)
      recording = await startRecording(page)
    }

    for (const step of shot.steps || []) {
      if (step.click) {
        let clickedAt = Date.now() / 1000
        if (recording) {
          const target = page.locator(step.click).first()
          await target.scrollIntoViewIfNeeded()
          const box = await target.boundingBox()
          if (step.flash) await target.evaluate(FLASH_ON, step.flash)
          await page.evaluate(() => { window.__sawLoading = false })
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
          await page.mouse.down()
          await page.waitForTimeout(TAP_HOLD_MS)
          clickedAt = Date.now() / 1000
          await page.mouse.up()
          await page.waitForTimeout(120)
          await page.evaluate(FLASH_OFF)
        } else {
          await page.locator(step.click).first().click()
        }
        // Videos skip "Loading…" screens: cut from the tap to when the page is
        // ready. The page notes if one showed at all, however briefly.
        if (recording) {
          await page.waitForTimeout(150)
          await page.waitForFunction(() => !document.body.innerText.includes('Loading…'))
          if (await page.evaluate(() => window.__sawLoading)) {
            recording.cutFrom(clickedAt)
            await page.waitForLoadState('networkidle')
            await page.waitForTimeout(200)
            await recording.resume()
          }
        }
      }
      if (step.tap) {
        const target = page.locator(step.tap).first()
        await target.scrollIntoViewIfNeeded()
        await target.evaluate(el => {
          (el.closest('a, button, li') || el).classList.add('tap-flash-green')
          const r = el.getBoundingClientRect()
          const dot = Object.assign(document.createElement('div'), { className: 'tap-ripple' })
          dot.style.left = r.left + r.width / 2 + 'px'; dot.style.top = r.top + r.height / 2 + 'px'
          document.body.appendChild(dot); setTimeout(() => dot.remove(), 750)
        })
        await page.waitForTimeout(TAP_HOLD_MS + 120)
        await page.evaluate(FLASH_OFF)
      }
      if (step.fill) await page.locator(step.fill[0]).first().fill(step.fill[1])
      // Scroll the window (not scrollIntoView, which can also shift the mobile visual viewport)
      if (step.scrollTo) await page.locator(step.scrollTo).first().evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY))
      if (step.scrollBy) await page.evaluate(y => window.scrollBy(0, y), step.scrollBy)
      if (step.smoothScrollBy) { await page.evaluate(y => window.scrollBy({ top: y, behavior: 'smooth' }), step.smoothScrollBy); await page.waitForTimeout(800) }
      if (step.wait) await page.waitForTimeout(step.wait)
      await page.waitForLoadState('networkidle')
    }
    if (recording) {
      await recording.stop(join(outDir, `${shot.name}.mp4`), { endCard: shot.endCard })
      console.log(`  ✓ ${shot.name} (video)`)
      await context.close()
      continue
    }
    await page.waitForTimeout(shot.settle ?? 1200) // charts draw in, store logos load

    const file = join(outDir, `${shot.name}.png`)
    if (shot.element) await page.locator(shot.element).first().screenshot({ path: file })
    else await page.screenshot({ path: file, fullPage: !!shot.fullPage })
    console.log(`  ✓ ${shot.name}`)
    await context.close()
  }
  await browser.close()
  for (const b of Object.values(videoBrowsers)) await (await b).close()
  console.log(`Saved ${shots.length} screenshots to ${outDir}`)
}

// Only wipe a local database that holds nothing but this script's demo data
// ── Video ────────────────────────────────────────────────────
// Records with Chrome's screencast (a frame each time the page repaints, with
// timestamps), then ffmpeg turns the frames into a constant-rate H.264 MP4
// Video ending: fade to a card with the logo, hold, fade into the first frame (seconds)
const END_CARD = { fade: 0.3, hold: 1.1, background: 'F9FAFB' } // background: the app's gray-50
const TAP_HOLD_MS = 300 // how long a video tap stays pressed before releasing
// While a video tap is held, the pressed link/button/row lights up green
// (a click step's "flash": "amber" | "green"; "tap" steps are always green)
const FLASH_ON = (el, color) => (el.closest('a, button, li') || el).classList.add(`tap-flash-${color}`)
const FLASH_OFF = () => document.querySelectorAll('.tap-flash-green, .tap-flash-amber').forEach(el => el.classList.remove('tap-flash-green', 'tap-flash-amber'))
const TAP_RIPPLE_CSS = `
  .tap-flash-green { box-shadow: 0 0 0 3px rgb(134 239 172 / 0.9), inset 0 0 0 999px rgb(187 247 208 / 0.5) !important;
    transition: box-shadow 120ms ease-out !important; }
  .tap-flash-amber { box-shadow: inset 0 0 0 999px rgb(254 243 199 / 0.9) !important; /* fill only: rows sit in clipped cards, so an outer ring shows as a bar */
    transition: box-shadow 120ms ease-out !important; }
  .tap-ripple { position: fixed; z-index: 9999; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%;
    background: rgb(0 0 0 / 0.22); border: 2px solid rgb(255 255 255 / 0.9); box-shadow: 0 0 0 1px rgb(0 0 0 / 0.08);
    pointer-events: none; animation: tap-ripple 0.7s ease-out forwards; }
  @keyframes tap-ripple { 0% { transform: scale(0.5); opacity: 1 } 45% { opacity: 0.9 } 100% { transform: scale(1.4); opacity: 0 } }`
const LOADING_WATCH_JS = `window.__sawLoading = false
new MutationObserver(() => { if (document.body.innerText.includes('Loading…')) window.__sawLoading = true })
  .observe(document.body, { childList: true, subtree: true, characterData: true })`
const TAP_RIPPLE_JS = `document.addEventListener('pointerdown', e => {
  const dot = Object.assign(document.createElement('div'), { className: 'tap-ripple' })
  dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'
  document.body.appendChild(dot); setTimeout(() => dot.remove(), 750)
}, true)`

async function startRecording(page) {
  const cdp = await page.context().newCDPSession(page)
  const frames = []
  // Cut stretches (see cutFrom) are taken out of the timeline entirely
  let paused = false, pausedTotal = 0, pausedAt = 0
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    if (!paused) frames.push({ data, time: metadata.timestamp - pausedTotal })
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  const { width, height } = page.viewportSize()
  const scale = await page.evaluate(() => devicePixelRatio)
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: width * scale, maxHeight: height * scale, everyNthFrame: 1 })
  return {
    // Drop frames from this moment (seconds since epoch) until resume()
    cutFrom(at) {
      while (frames.length > 1 && frames.at(-1).time >= at - pausedTotal) frames.pop()
      paused = true
      pausedAt = at
    },
    async resume() {
      pausedTotal += Date.now() / 1000 - pausedAt
      paused = false
      // The screencast only sends frames on repaint, so grab the current screen now
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
      frames.push({ data, time: Date.now() / 1000 - pausedTotal })
    },
    async stop(file, { endCard } = {}) {
      await page.waitForTimeout(endCard ? 850 : 1500) // hold the last frame
      await cdp.send('Page.stopScreencast')
      const end = Date.now() / 1000 - pausedTotal
      const dir = mkdtempSync(join(tmpdir(), 'receipts-video-'))
      const list = frames.map((f, i) => {
        writeFileSync(join(dir, `${i}.png`), Buffer.from(f.data, 'base64'))
        const next = frames[i + 1]?.time ?? Math.max(end, f.time + 0.04)
        return `file '${i}.png'\nduration ${(next - f.time).toFixed(4)}`
      })
      // ffmpeg's concat format ignores the last duration unless the file is listed again
      writeFileSync(join(dir, 'list.txt'), `${list.join('\n')}\nfile '${frames.length - 1}.png'\n`)
      const encode = '-c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p -movflags +faststart -an'
      const even = 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,fps=30,format=yuv420p'
      if (!endCard) {
        execSync(`ffmpeg -y -loglevel error -f concat -safe 0 -i list.txt -vf "${even}" ${encode} "${file}"`, { cwd: dir })
      } else {
        execSync(`ffmpeg -y -loglevel error -f concat -safe 0 -i list.txt -vf "${even}" ${encode} main.mp4`, { cwd: dir })
        const length = Number(execSync('ffprobe -v error -show_entries format=duration -of csv=p=0 main.mp4', { cwd: dir, encoding: 'utf8' }))
        const [w, h] = execSync('ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 main.mp4', { cwd: dir, encoding: 'utf8' }).trim().split(',').map(Number)
        const logo = Math.round(w * 0.3)
        const { fade, hold } = END_CARD
        // Card in the app's background gray: the logo with "Receipts" under it,
        // in the app's font (drawn by the browser rather than ffmpeg)
        const icon = `data:image/svg+xml;base64,${readFileSync(join(root, 'public', 'icon.svg')).toString('base64')}`
        const cardBrowser = await chromium.launch()
        const cardPage = await cardBrowser.newPage({ viewport: { width: w, height: h } })
        await cardPage.setContent(`<body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
          gap:${Math.round(w * 0.04)}px;background:#${END_CARD.background};font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">
          <img src="${icon}" style="width:${logo}px;height:${logo}px">
          <div style="font-size:${Math.round(w * 0.085)}px;font-weight:700;color:#111827;letter-spacing:-0.01em">Receipts</div></body>`)
        await cardPage.screenshot({ path: join(dir, 'card.png') })
        await cardBrowser.close()
        const cardLength = fade + hold + fade
        execSync(`ffmpeg -y -loglevel error -i main.mp4 -loop 1 -t ${cardLength} -i card.png -loop 1 -t ${fade + 0.05} -i 0.png -filter_complex "` +
          // xfade needs every input at the same size, rate and timebase
          `[0]${even},settb=AVTB[main];[1]${even},settb=AVTB[card];[2]${even},settb=AVTB[first];` +
          `[main][card]xfade=transition=fade:duration=${fade}:offset=${(length - fade).toFixed(3)}[a];` +
          `[a][first]xfade=transition=fade:duration=${fade}:offset=${(length - fade + cardLength - fade).toFixed(3)}" ${encode} "${file}"`, { cwd: dir })
      }
      copyFileSync(join(dir, '0.png'), file.replace(/\.mp4$/, '-poster.png'))
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

// ── Landing page copies ──────────────────────────────────────
// The app's signed-out landing page uses some of the same shots, as smaller
// WebP files in public/landing (shots.json → appAssets: file → width, or
// null to copy as-is)
async function exportAppAssets() {
  const { outDir: appDir, files } = config.appAssets || {}
  if (!files) return
  const from = resolve(here, config.outDir), to = resolve(here, appDir)
  mkdirSync(to, { recursive: true })
  for (const [name, width] of Object.entries(files)) {
    if (width === null) { copyFileSync(join(from, name), join(to, name)); continue }
    const out = name.replace(/\.png$/, '.webp')
    execSync(`ffmpeg -y -loglevel error -i "${join(from, name)}" -vf scale=${width}:-1:flags=lanczos -c:v libwebp -quality 82 "${join(to, out)}"`)
  }
  console.log(`Exported ${Object.keys(files).length} files for the landing page to ${to}`)

  // Link-preview image for index.html's og:image
  const html = readFileSync(join(here, 'og-image.html'), 'utf8')
    .replaceAll('{{shots}}', pathToFileURL(from).href)
    .replaceAll('{{icon}}', pathToFileURL(join(root, 'public', 'icon.svg')).href)
  const page = join(tmpdir(), 'receipts-og-image.html')
  writeFileSync(page, html)
  const browser = await chromium.launch()
  const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } })
  await tab.goto(pathToFileURL(page).href)
  await tab.waitForLoadState('networkidle')
  await tab.screenshot({ path: join(root, 'public', 'og-image.png') })
  await browser.close()
  rmSync(page)
  console.log('Rendered public/og-image.png')
}

function checkSafeToReset() {
  if (args.includes('--force-reset')) return
  let out
  try {
    out = execSync(`docker exec ${DB_CONTAINER} psql -U postgres -tA -c "select (select count(*) from auth.users where email not like '%@example.com'), (select count(*) from auth.users), (select count(*) from public.receipts)"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch { return } // no tables yet: nothing to lose
  const [otherUsers, users, receipts] = out.split('|').map(Number)
  if (otherUsers > 0 || (users === 0 && receipts > 0)) {
    throw new Error(`The local database has data that isn't from this script (${receipts} receipts, ${otherUsers} non-demo accounts). ` +
      'Not resetting it. Use --no-reset to keep it, or --force-reset to wipe it anyway.')
  }
}

// ── Run ──────────────────────────────────────────────────────
const supa = localSupabase()
let idByKey
if (reset) {
  checkSafeToReset()
  console.log('Resetting the local database…')
  sh(`${SUPABASE} db reset --local`)
  idByKey = await seed(supa)
} else {
  idByKey = await receiptKeys(supa)
}
const { server, base } = await startApp(supa)
try {
  await takeShots(supa, base, idByKey)
  await exportAppAssets()
} finally {
  server.kill()
}
