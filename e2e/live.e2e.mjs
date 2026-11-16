// Browser tests for live updates and editing at the same time: two people
// (Milo and Alex, the test accounts) in their own browsers, against the
// local UI-testing stack. Nobody reloads: what one does should appear on
// the other's screen by itself.
//
//   npm run ui:start        (once; needs Docker)
//   npm run ui:reset        (fresh data)
//   npm run ui:dev          (in another terminal: the app on :5180)
//   npm run test:e2e:live
//
// It loads e2e/live_fixtures.sql (its own receipts) and can run again and
// again, but needs a fresh reset after e2e/app.e2e.mjs (which adds a second
// Alex to the group): run it first. Each check prints ok/FAIL; the run ends
// with the number that failed.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'

const BASE = 'http://localhost:5180/WhipOutTheReceipts/'
const DB_URL = 'postgresql://postgres:postgres@host.docker.internal:54422/postgres'
const R = {
  check: 'e2e10000-0000-4000-8000-000000000001',
  reopen: 'e2e10000-0000-4000-8000-000000000002',
  edit: 'e2e10000-0000-4000-8000-000000000003',
  unclaimed: 'e2e10000-0000-4000-8000-000000000004',
  pay: 'e2e10000-0000-4000-8000-000000000005',
  guest: 'e2e10000-0000-4000-8000-000000000006',
  conflict: 'e2e10000-0000-4000-8000-000000000007',
  deleted: 'e2e10000-0000-4000-8000-000000000008',
}
const GUEST_TOKEN = 'e2e0live0guest0token0000000000000000'
const GROUP = "(select id from groups where invite_code = '348U9RQ5')"
const ACCOUNTS = { Milo: 'milo@test.local', Alex: 'alex@test.local' }
const member = name => ACCOUNTS[name]
  ? `(select id from group_members where group_id = ${GROUP} and user_id = (select id from auth.users where email = '${ACCOUNTS[name]}'))`
  : `(select id from group_members where group_id = ${GROUP} and first_name = '${name}')`
const PHONE = { viewport: { width: 384, height: 832 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const DESKTOP = { viewport: { width: 1200, height: 900 } }

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ── Helpers ──────────────────────────────────────────────────
const psql = args => execFileSync('docker', ['run', '--rm', '-v', `${root}:/w`, 'postgres:17-alpine', 'psql', DB_URL, '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', ...args],
  { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } }).trim()
const sqlFile = file => psql(['-f', `/w/${file}`])
// One statement as the database owner (like a change made from another device)
const sql = statement => psql(['-c', statement])

let failed = 0
function check(ok, what) {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}

const browser = await chromium.launch()
const errors = []

async function open(device, email) {
  const context = await browser.newContext(device)
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(e.message))
  if (email) {
    await page.goto(BASE + '#/signin')
    await page.fill('input[type=email]', email)
    await page.fill('input[type=password]', 'test1234')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(3500)
  }
  return page
}

const pause = (page, ms = 600) => page.waitForTimeout(ms)
const sleep = ms => new Promise(r => setTimeout(r, ms))
// Wait (without reloading) until something is true; false if it never is
async function waitFor(fn, ms = 10000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { if (await fn()) return true } catch {}
    await sleep(250)
  }
  return false
}
const dialog = (page, title) => page.locator(`h2:has-text("${title}")`)
const modal = page => page.locator('[aria-modal="true"]')
// Open a page by address, then give its live connection a moment to start
async function go(page, path) { await page.goto(BASE + '#' + path); await pause(page, 3000) }
const text = page => page.locator('body').innerText()
const row = (page, name) => page.locator('li', { hasText: name }).first()
const toCheckOff = page => page.locator('section', { hasText: /to check off/ })

// ── Setup ────────────────────────────────────────────────────
// The checks read names as shown ("Alex claimed it"); a second Alex in the
// group (e2e/app.e2e.mjs's joining test adds one) would show as "Alex T."
if (sql(`select count(*) from group_members where group_id = ${GROUP} and first_name in ('Alex', 'Milo') and active`) !== '2') {
  console.error('This needs a fresh database (npm run ui:reset): e2e/app.e2e.mjs adds a second Alex. Run this one first, or reset in between.')
  process.exit(1)
}
sqlFile('e2e/live_fixtures.sql')

const milo = await open(DESKTOP, 'milo@test.local')
const alex = await open(PHONE, 'alex@test.local')

// ── A new receipt shows up for everyone on it, and in search ─
{
  console.log('\nNew receipts')
  const alexSearch = await open(DESKTOP, 'alex@test.local')
  await go(alex, '/')
  await go(alexSearch, '/receipts?q=Zorbleberries')
  check(await alexSearch.getByText('Nothing matching').count() === 1, 'search finds nothing yet')

  await go(milo, '/receipt/new')
  await milo.fill('input[placeholder="e.g. Costco"]', 'Live New Store')
  const names = milo.locator('input[placeholder="Item name"]')
  const prices = milo.locator('input[placeholder="0.00"]')
  await names.nth(0).fill('Zorbleberries'); await prices.nth(0).fill('2.50')
  await names.nth(1).fill('Quinoa'); await prices.nth(1).fill('4')
  await milo.getByRole('button', { name: 'Save Receipt' }).click()
  check(await waitFor(async () => /#\/receipt\/[0-9a-f-]{36}$/.test(milo.url())), 'saving a new receipt opens it')
  await pause(milo, 1500)
  check((await milo.locator('li[role=checkbox]').allInnerTexts()).map(t => t.split('\n')[0].trim()).slice(0, 2).join(',').includes('Zorbleberries'),
    'its items are there, in order')
  check(await milo.locator('li[role=checkbox]').nth(1).innerText().then(t => t.includes('Quinoa')), '…second item second')

  check(await waitFor(async () => (await toCheckOff(alex).innerText()).includes('Live New Store')),
    "it appears on Alex's Home by itself (no reload)")
  check(await waitFor(async () => await alexSearch.locator('a', { hasText: 'Zorbleberries' }).count() > 0),
    "…and in Alex's open search results")
  await alexSearch.context().close()
}

// ── Check-offs appear live; your unsaved ones are kept ───────
{
  console.log('\nCheck-offs')
  await go(alex, `/receipt/${R.check}`)
  // First visit: everything is checked; Alex unchecks Cherries but doesn't save
  await row(alex, 'Cherries').click(); await pause(alex, 300)
  check(await row(alex, 'Cherries').getAttribute('aria-checked') === 'false', "Alex unchecks Cherries (not saved)")

  await go(milo, `/receipt/${R.check}`)
  await row(milo, 'Bananas').click(); await row(milo, 'Cherries').click()
  await milo.getByRole('button', { name: 'Save my claims' }).click(); await pause(milo, 1500)

  check(await waitFor(async () => (await row(alex, 'Apples').innerText()).includes('Milo')),
    "Milo's check-off shows on Alex's open receipt by itself")
  check(await row(alex, 'Cherries').getAttribute('aria-checked') === 'false' && await row(alex, 'Bananas').getAttribute('aria-checked') === 'true',
    "…and Alex's unsaved check-offs are kept")

  // An item added while Alex has unsaved check-offs: Alex has to answer it
  sql(`insert into items (receipt_id, name, price, position) values ('${R.check}', 'Dates', 7, 3)`)
  check(await waitFor(async () => await alex.locator('[data-new-item]', { hasText: 'Dates' }).count() === 1),
    'an item added meanwhile shows up asking Mine / Not mine (not a checkbox)')
  check(await row(alex, 'Cherries').getAttribute('aria-checked') === 'false', "…and Alex's unsaved check-offs are still kept")
  await alex.getByRole('button', { name: 'Save my claims' }).click(); await pause(alex, 500)
  check(await dialog(alex, 'New items to check').count() === 1, 'saving first asks about the new item')
  await modal(alex).getByRole('button').first().click(); await pause(alex, 300)
  await alex.locator('[data-new-item]', { hasText: 'Dates' }).getByRole('button', { name: 'Not mine' }).click(); await pause(alex, 300)
  check(await row(alex, 'Dates').getAttribute('aria-checked') === 'false', '"Not mine" leaves it unchecked')
  check(await row(alex, 'Dates').innerText().then(t => t.includes('NEW') || t.includes('New')), '…marked as new')
  await alex.getByRole('button', { name: 'Save my claims' }).click(); await pause(alex, 2000)
  check(await alex.getByText('Saved ✓').count() === 1, 'then it saves')
  const alexClaims = sql(`select string_agg(i.name, ',' order by i.position) from claims c join items i on i.id = c.item_id where i.receipt_id = '${R.check}' and c.member_id = ${member('Alex')}`)
  check(alexClaims === 'Apples,Bananas', `Alex's saved check-offs are what he picked (${alexClaims})`)
}

// ── Saving from an out-of-date page ──────────────────────────
{
  console.log('\nOut of date')
  // Alex's page misses a change (offline for a moment): saving shows it first
  await go(alex, `/receipt/${R.check}`)
  await alex.context().setOffline(true)
  sql(`update items set price = 3.25 where receipt_id = '${R.check}' and name = 'Apples'`)
  await sleep(1500)
  await row(alex, 'Bananas').click(); await pause(alex, 300)
  await alex.context().setOffline(false)
  await alex.getByRole('button', { name: 'Save my claims' }).click()
  // Either the live update arrived first (and it just saves), or the save
  // noticed the change and showed it
  const changed = await waitFor(async () => await dialog(alex, 'This receipt changed').count() === 1 || await alex.getByText('Saved ✓').count() === 1, 8000)
  check(changed, 'saving after missing a change either shows the change first or saves the current receipt')
  if (await dialog(alex, 'This receipt changed').count()) {
    await modal(alex).getByRole('button').first().click(); await pause(alex, 300)
    check(await row(alex, 'Bananas').getAttribute('aria-checked') === 'false', '…keeping the unsaved check-off')
  }
  check(await waitFor(async () => (await row(alex, 'Apples').innerText()).includes('3.25')), 'the page shows the new price')
}

// ── Editing reopens only for added items, with the reason ────
{
  console.log('\nReopening')
  await go(alex, '/')
  check(!(await text(alex)).includes('Live Reopen'), "Alex has checked in on Live Reopen (it isn't on Home)")

  await go(milo, `/receipt/${R.reopen}/edit`)
  const names = milo.locator('input[placeholder="Item name"]')
  await names.nth(3).fill('Eggs'); await milo.locator('input[placeholder="0.00"]').nth(3).fill('4')
  await milo.getByRole('button', { name: 'Save Changes' }).click()
  await waitFor(async () => !milo.url().endsWith('/edit'))

  check(await waitFor(async () => (await toCheckOff(alex).innerText()).includes('Live Reopen')),
    "adding an item puts the receipt back on Alex's Home by itself")
  check(await alex.locator('[data-reopened]', { hasText: 'Milo added Eggs' }).count() === 1, '…saying why: "Milo added Eggs"')

  await alex.locator('a', { hasText: 'Live Reopen' }).first().click(); await pause(alex, 2500)
  check(await alex.locator('[data-new-item]', { hasText: 'Eggs' }).count() === 1, 'on the receipt, Eggs asks Mine / Not mine')
  check(await alex.locator('[data-new-item]', { hasText: 'Milo added this after you checked in' }).count() === 1, '…saying who added it')
  check(await row(alex, 'Milk').getAttribute('aria-checked') === 'true', "Alex's milk is still checked")
  await alex.locator('[data-new-item]').getByRole('button', { name: 'Mine', exact: true }).click(); await pause(alex, 300)
  await alex.getByRole('button', { name: 'Save my claims' }).click(); await pause(alex, 2000)
  await go(alex, '/')
  check(!(await text(alex)).includes('Live Reopen'), 'after saving, it leaves Home')

  // Price change on Alex's milk: a popup on Home, the receipt isn't reopened
  await go(milo, `/receipt/${R.reopen}/edit`)
  await milo.locator('input[placeholder="0.00"]').nth(0).fill('4.99')
  await milo.getByRole('button', { name: 'Save Changes' }).click()
  await waitFor(async () => !milo.url().endsWith('/edit'))
  check(await waitFor(async () => await dialog(alex, 'A price changed').count() === 1),
    "a price change on Alex's milk pops up on his Home by itself")
  const popup = await modal(alex).innerText()
  check(popup.includes('Milo') && popup.includes('Milk') && popup.includes('$5.49') && popup.includes('$4.99'), '…saying who, what, and from/to')
  check(!(await toCheckOff(alex).count()) || !(await toCheckOff(alex).innerText()).includes('Live Reopen'), '…and the receipt is not reopened')
  await modal(alex).getByRole('button', { name: 'Looks good' }).click(); await pause(alex, 1000)
  await alex.reload(); await pause(alex, 3000)
  check(await dialog(alex, 'A price changed').count() === 0, '"Looks good" makes it go away for good')

  // Removing an item and changing the tax: nothing for Alex
  await go(milo, `/receipt/${R.reopen}/edit`)
  // Butter is the third item
  check(await milo.locator('input[placeholder="Item name"]').nth(2).inputValue() === 'Butter', '(Butter is the third item in the editor)')
  await milo.getByRole('button', { name: 'Remove item' }).nth(2).click(); await pause(milo, 300)
  const extras = milo.locator('input[placeholder="0.00"]')
  await extras.nth((await extras.count()) - 2).fill('2')
  await milo.getByRole('button', { name: 'Save Changes' }).click()
  await waitFor(async () => !milo.url().endsWith('/edit'))
  await sleep(3000)
  check(sql(`select deleted_at is not null from items where receipt_id = '${R.reopen}' and name = 'Butter'`) === 't'
    && Number(sql(`select tax from receipts where id = '${R.reopen}'`)) === 2, '(Butter was removed and the tax changed)')
  check(!(await text(alex)).includes('Live Reopen') && await dialog(alex, 'price').count() === 0,
    'removing an item and changing the tax do not reopen it or pop anything up')
  await go(milo, `/receipt/${R.reopen}`)
  await milo.getByRole('button', { name: /changes?$/ }).last().click(); await pause(milo, 800)
  const history = await text(milo)
  check(history.includes('changed the price of "Milk" from $5.49 to $4.99') && history.includes('removed "Butter"') && history.includes('added "Eggs"'),
    "the receipt's history has the edits")
  check(!/changed\s*$/m.test(history) && !history.includes('undefined'), '…and no empty entries (version bumps are not edits)')
  sql(`update items set price = 3.10 where receipt_id = '${R.reopen}' and name = 'Bread'`)
  check(await waitFor(async () => (await text(milo)).includes('changed the price of "Bread" from $3.00 to $3.10')),
    'a change made elsewhere shows up in the open history by itself (and it stays open)')
}

// ── Editing at the same time ─────────────────────────────────
{
  console.log('\nEditing at the same time')
  await go(milo, `/receipt/${R.edit}/edit`)
  await go(alex, `/receipt/${R.edit}`)
  check(await waitFor(async () => await alex.locator('[data-editing-now]', { hasText: 'Milo is editing this receipt right now' }).count() === 1),
    "the receipt page says Milo is editing it")
  await alex.getByRole('link', { name: 'Edit receipt' }).click(); await pause(alex, 2500)
  check(await waitFor(async () => await alex.locator('[data-edit-lock]', { hasText: 'Milo is editing this receipt right now' }).count() === 1),
    "opening the editor too: it's locked, saying who has it")
  check(await alex.locator('input[placeholder="Item name"]').first().isDisabled(), '…and its fields are read-only')

  // Milo leaves without saving: Alex's editor unlocks by itself
  await milo.getByRole('button', { name: /Back/ }).first().click(); await pause(milo, 1500)
  check(await waitFor(async () => await alex.locator('[data-edit-lock]').count() === 0 && !(await alex.locator('input[placeholder="Item name"]').first().isDisabled())),
    'when Milo leaves, the editor unlocks by itself')
  await alex.getByRole('button', { name: /Back/ }).first().click(); await pause(alex, 1500)

  // "Edit anyway": both save, and both changes are kept
  await go(milo, `/receipt/${R.edit}/edit`)
  await go(alex, `/receipt/${R.edit}/edit`)
  await waitFor(async () => await alex.locator('[data-edit-lock]').count() === 1)
  await alex.getByRole('button', { name: /Edit anyway/ }).click(); await pause(alex, 300)
  check(!(await alex.locator('input[placeholder="Item name"]').first().isDisabled()), '"Edit anyway" lets Alex edit')
  await milo.locator('input[placeholder="Item name"]').nth(0).fill('Blood oranges')
  await alex.locator('input[placeholder="0.00"]').nth(1).fill('7')
  await alex.getByRole('button', { name: 'Save Changes' }).click()
  await waitFor(async () => !alex.url().endsWith('/edit'))
  check(await waitFor(async () => await milo.locator('[data-they-changed]').count() === 1),
    "Milo's editor says Alex changed it meanwhile (and that saving combines them)")
  await milo.getByRole('button', { name: 'Save Changes' }).click()
  check(await waitFor(async () => !milo.url().endsWith('/edit')), "Milo's save goes through without asking (they changed different things)")
  const items = sql(`select string_agg(name || '=' || price, ',' order by position) from items where receipt_id = '${R.edit}' and deleted_at is null`)
  check(items === 'Blood oranges=4.00,Pears=7.00', `both edits are kept (${items})`)

  // The same price changed by both: Milo is asked which to keep
  await go(milo, `/receipt/${R.conflict}/edit`)
  await go(alex, `/receipt/${R.conflict}/edit`)
  await waitFor(async () => await alex.locator('[data-edit-lock]').count() === 1)
  await alex.getByRole('button', { name: /Edit anyway/ }).click(); await pause(alex, 300)
  await alex.locator('input[placeholder="0.00"]').nth(0).fill('5')
  await alex.getByRole('button', { name: 'Save Changes' }).click()
  await waitFor(async () => !alex.url().endsWith('/edit'))
  await milo.locator('input[placeholder="0.00"]').nth(0).fill('4.50')
  await milo.getByRole('button', { name: 'Save Changes' }).click()
  check(await waitFor(async () => await dialog(milo, 'Someone else changed this receipt too').count() === 1),
    'when both changed the same price, Milo is asked which to keep')
  check((await modal(milo).innerText()).includes('$5.00') && (await modal(milo).innerText()).includes('$4.50'), '…showing both prices')
  await modal(milo).getByRole('button', { name: 'Back to editing' }).click(); await pause(milo, 500)
  check(sql(`select price from items where receipt_id = '${R.conflict}' and name = 'Grapes' and deleted_at is null`) === '5.00',
    '"Back to editing" saves nothing')
  await milo.getByRole('button', { name: 'Save Changes' }).click()
  await waitFor(async () => await dialog(milo, 'Someone else changed this receipt too').count() === 1)
  const saveBtn = modal(milo).getByRole('button', { name: 'Save' })
  check(await saveBtn.isDisabled(), "Save waits until there's an answer")
  await modal(milo).locator('label', { hasText: '$4.50' }).click()
  await saveBtn.click()
  check(await waitFor(async () => !milo.url().endsWith('/edit')), 'picking one saves')
  check(sql(`select string_agg(name || '=' || price, ',' order by position) from items where receipt_id = '${R.conflict}' and deleted_at is null`) === 'Grapes=4.50,Kiwis=6.00',
    "Milo's price is kept (his choice), the rest untouched")

  // Deleted while being edited: the save says so instead of bringing it back
  await go(milo, `/receipt/${R.deleted}/edit`)
  sql(`update receipts set deleted_at = now() where id = '${R.deleted}'`)
  await milo.locator('input[placeholder="0.00"]').nth(0).fill('3')
  await milo.getByRole('button', { name: 'Save Changes' }).click()
  check(await waitFor(async () => await dialog(milo, 'This receipt was deleted').count() === 1), 'saving a receipt deleted meanwhile says so')
  check(sql(`select deleted_at is not null from receipts where id = '${R.deleted}'`) === 't', "…and it stays deleted")
  await modal(milo).getByRole('button').first().click()
}

// ── Nothing moves under your finger ──────────────────────────
{
  console.log('\nWhile you tap')
  await go(milo, '/')
  check(await row(milo, 'Mystery Jam').count() === 1, 'Milo sees the unclaimed Mystery Jam on Home')
  await go(alex, '/')
  await row(alex, 'Mystery Jam').getByRole('button', { name: "It's mine" }).click()
  check(await waitFor(async () => await milo.locator('li[data-gone]', { hasText: 'Alex claimed it' }).count() === 1),
    "when Alex claims it, it stays where it was on Milo's Home, dimmed: \"Alex claimed it\"")
  check(await milo.locator('li[data-gone]', { hasText: 'Mystery Jam' }).getByRole('button').count() === 0, '…with no buttons left to tap')

  // A finger on the screen: the update waits until it lifts
  await go(alex, '/')
  const box = await alex.locator('h1, h2, p').first().boundingBox()
  await alex.mouse.move(box.x + 5, box.y + 5)
  await alex.mouse.down()
  sql(`select set_config('app.skip_audit','on',false); insert into receipts (group_id, store_name, receipt_date, paid_by_member, member_ids) values (${GROUP}, 'Live While Holding', '2026-10-22', ${member('Milo')}, array[${member('Milo')}, ${member('Alex')}]); insert into items (receipt_id, name, price) select id, 'Held', 1 from receipts where store_name = 'Live While Holding'`)
  await sleep(4000)
  check(!(await text(alex)).includes('Live While Holding'), "while Alex's finger is down, the new receipt doesn't appear")
  await alex.mouse.up()
  check(await waitFor(async () => (await text(alex)).includes('Live While Holding'), 6000), '…and appears once it lifts')

  // An open dialog holds updates too
  await go(alex, '/')
  await alex.evaluate(() => {
    const d = document.createElement('div'); d.setAttribute('aria-modal', 'true'); d.id = 'test-modal'; document.body.appendChild(d)
  })
  sql(`insert into receipts (group_id, store_name, receipt_date, paid_by_member, member_ids) values (${GROUP}, 'Live While Dialog', '2026-10-22', ${member('Milo')}, array[${member('Milo')}, ${member('Alex')}]); insert into items (receipt_id, name, price) select id, 'D', 1 from receipts where store_name = 'Live While Dialog'`)
  await sleep(4000)
  check(!(await text(alex)).includes('Live While Dialog'), 'while a dialog is open, the page behind it does not change')
  await alex.evaluate(() => document.getElementById('test-modal').remove())
  check(await waitFor(async () => (await text(alex)).includes('Live While Dialog'), 6000), '…and catches up when it closes')
}

// ── Payments ─────────────────────────────────────────────────
{
  console.log('\nPayments')
  await go(milo, `/receipt/${R.pay}`)
  await go(alex, `/receipt/${R.pay}`)
  await alex.getByRole('button', { name: 'Mark sent' }).click(); await pause(alex, 300)
  check(await dialog(alex, 'Mark as sent?').count() === 1, 'Mark sent asks first')
  // Meanwhile Milo marks it received from his phone
  sql(`insert into payments (group_id, from_member, to_member, amount, receipt_id) values (${GROUP}, ${member('Alex')}, ${member('Milo')}, 11, '${R.pay}')`)
  check(await waitFor(async () => (await text(milo)).includes('✓ Paid') || (await text(milo)).includes('✓ Sent')),
    "the payment shows on Milo's open receipt by itself")
  await modal(alex).getByRole('button', { name: 'Mark sent' }).click()
  check(await waitFor(async () => await dialog(alex, 'Already paid').count() === 1), "Alex's Mark sent notices it's already paid instead of paying twice")
  await modal(alex).getByRole('button').first().click()
  check(sql(`select count(*) from payments where receipt_id = '${R.pay}' and deleted_at is null`) === '1', 'only one payment was recorded')

  // Balances update live too
  await go(alex, '/balances')
  const before = await text(alex)
  sql(`update payments set deleted_at = now() where receipt_id = '${R.pay}'`)
  check(await waitFor(async () => (await text(alex)) !== before), "removing the payment updates Alex's open Balances by itself")
}

// ── Guest link: a save from an out-of-date receipt ───────────
{
  console.log('\nGuest link')
  const guest = await open(PHONE)
  await guest.goto(BASE + `#/guest/${GUEST_TOKEN}`); await pause(guest, 2500)
  await guest.getByRole('button', { name: /Live Guest/ }).click(); await pause(guest, 800)
  sql(`insert into items (receipt_id, name, price, position) values ('${R.guest}', 'Bread rolls', 3, 2)`)
  await sleep(1000)
  await guest.locator('button[role=checkbox]', { hasText: 'Salad' }).click()
  await guest.getByRole('button', { name: 'Save' }).click()
  check(await waitFor(async () => await guest.locator('[data-changed-note]').count() === 1), "the guest's save is held: \"someone changed this receipt\"")
  check(await guest.locator('[data-new-item]', { hasText: 'Bread rolls' }).count() === 1, '…the new item asks Mine / Not mine')
  check(await guest.locator('button[role=checkbox]', { hasText: 'Salad' }).getAttribute('aria-checked') === 'false', "…and the guest's unsaved check is kept")
  check(sql(`select count(*) from checkins where receipt_id = '${R.guest}' and member_id = ${member('Clouey')}`) === '0', '…and nothing was saved')
  await guest.getByRole('button', { name: 'Save' }).click(); await pause(guest, 500)
  check((await text(guest)).includes('Choose Mine or Not mine'), "saving again first asks for an answer")
  await guest.locator('[data-new-item]').getByRole('button', { name: 'Not mine' }).click()
  await guest.getByRole('button', { name: 'Save' }).click()
  check(await waitFor(async () => sql(`select count(*) from checkins where receipt_id = '${R.guest}' and member_id = ${member('Clouey')}`) === '1'), 'then it saves')
  check(sql(`select string_agg(i.name, ',' order by i.position) from claims c join items i on i.id = c.item_id where i.receipt_id = '${R.guest}' and c.member_id = ${member('Clouey')}`) === 'Soup',
    'with what the guest picked (Soup, not Salad or the rolls)')
  await guest.context().close()
}

// ── Back online, back to the app ─────────────────────────────
{
  console.log('\nReconnecting')
  await go(alex, '/')
  await alex.context().setOffline(true)
  sql(`insert into receipts (group_id, store_name, receipt_date, paid_by_member, member_ids) values (${GROUP}, 'Live While Offline', '2026-10-22', ${member('Milo')}, array[${member('Milo')}, ${member('Alex')}]); insert into items (receipt_id, name, price) select id, 'O', 1 from receipts where store_name = 'Live While Offline'`)
  await sleep(2000)
  check(!(await text(alex)).includes('Live While Offline'), 'offline: the change made meanwhile has not arrived')
  await alex.context().setOffline(false)
  check(await waitFor(async () => (await text(alex)).includes('Live While Offline'), 15000), 'back online, it catches up by itself')

  // Away from the app (tab hidden / phone locked) and back
  sql(`insert into receipts (group_id, store_name, receipt_date, paid_by_member, member_ids) values (${GROUP}, 'Live While Away', '2026-10-22', ${member('Milo')}, array[${member('Milo')}, ${member('Alex')}]); insert into items (receipt_id, name, price) select id, 'A', 1 from receipts where store_name = 'Live While Away'`)
  await alex.evaluate(async () => {
    const set = v => Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
    set('hidden'); document.dispatchEvent(new Event('visibilitychange'))
    await new Promise(r => setTimeout(r, 2500))
    set('visible'); document.dispatchEvent(new Event('visibilitychange'))
  })
  check(await waitFor(async () => (await text(alex)).includes('Live While Away')), 'coming back to the app, it is up to date')
}

// ── A new version of the app ─────────────────────────────────
{
  console.log('\nNew version')
  check(await milo.getByText('A new version of OurReceipts is ready').count() === 0, 'no "new version" bar when there is none')
  const page = await open(PHONE)
  await page.route('**/version.json*', r => r.fulfill({ contentType: 'application/json', body: '{"version": 999999}' }))
  await page.goto(BASE + '#/'); await pause(page, 2500)
  check(await page.getByText('A new version of OurReceipts is ready').count() === 1, 'after a deploy, open copies offer "Refresh"')
  check(await page.getByRole('button', { name: 'Refresh' }).count() === 1, '…with a Refresh button')
  await page.context().close()
}

// ── Everyday things (not live, but untested before) ──────────
{
  console.log('\nEveryday things')
  const money = page => async locator => Number((await locator.innerText()).replace(/[^0-9.-]/g, ''))

  // A receipt with a meal, tip and tax, saved in one go
  await go(milo, '/receipt/new')
  await milo.fill('input[placeholder="e.g. Costco"]', 'Live Dinner Out')
  const names = milo.locator('input[placeholder="Item name"]')
  await names.nth(0).fill('Fries'); await names.nth(0).press('Enter'); await milo.keyboard.type('5')
  await milo.getByRole('button', { name: '+ Add Meal Group' }).click(); await pause(milo, 300)
  await milo.getByLabel('Meal name').fill('Dinner')
  await milo.getByLabel('Meal fee').fill('1')
  await names.nth(2).fill('Burger'); await names.nth(2).press('Enter'); await milo.keyboard.type('8')
  const zeroes = milo.locator('input[placeholder="0.00"]')
  const n = await zeroes.count()
  await zeroes.nth(n - 3).fill('2') // tip
  await zeroes.nth(n - 2).fill('1') // tax
  await milo.getByRole('button', { name: 'Save Receipt' }).click()
  await waitFor(async () => /#\/receipt\/[0-9a-f-]{36}$/.test(milo.url())); await pause(milo, 2000)
  const page = await text(milo)
  check(page.includes('Fries') && page.includes('Dinner') && page.includes('1 item') && page.includes('includes $1.00 fee'),
    'a new receipt with a meal: the meal, its item count and fee show')
  check(page.includes('Tax $1.00') && page.includes('Tip $2.00'), '…and its tip and tax')
  const rid = new URL(milo.url()).hash.split('/').pop()
  check(sql(`select string_agg(i.name || ':' || coalesce(m.name, '-'), ',' order by i.position) from items i left join meals m on m.id = i.meal_id where i.receipt_id = '${rid}'`) === 'Fries:-,Burger:Dinner',
    '…saved with Burger in the meal')

  // Taking someone off a receipt clears their check-offs and check-in
  await go(milo, `/receipt/${'e2e10000-0000-4000-8000-000000000009'}/edit`)
  const alexChip = milo.getByRole('button', { name: 'Alex', exact: true })
  check(await alexChip.getAttribute('aria-pressed') === 'true', 'Alex is on Live People')
  await alexChip.click()
  await milo.getByRole('button', { name: 'Save Changes' }).click()
  await waitFor(async () => !milo.url().endsWith('/edit')); await pause(milo, 1000)
  check(sql(`select count(*) from claims c join items i on i.id = c.item_id where i.receipt_id = 'e2e10000-0000-4000-8000-000000000009' and c.member_id = ${member('Alex')}`) === '0'
    && sql(`select count(*) from checkins where receipt_id = 'e2e10000-0000-4000-8000-000000000009' and member_id = ${member('Alex')}`) === '0',
    'taking Alex off a receipt clears his check-offs and check-in')

  // Checking something off changes what you owe on Home
  await go(alex, '/')
  const owe = alex.locator('p', { hasText: /^You owe$/ }).locator('xpath=following-sibling::p[1]')
  const before = await money(alex)(owe)
  await go(alex, `/receipt/${R.check}`)
  if (await row(alex, 'Cherries').getAttribute('aria-checked') === 'false') await row(alex, 'Cherries').click()
  await alex.getByRole('button', { name: 'Save my claims' }).click(); await pause(alex, 2000)
  await go(alex, '/')
  const after = await money(alex)(owe)
  // Nobody had them, so they were split between Milo and Alex ($2.50 each):
  // claiming them adds Milo's half
  check(Math.abs(after - before - 2.5) < 0.02, `checking off the (unclaimed, split) $5 cherries adds Milo's $2.50 half to what Alex owes ($${before} → $${after})`)

  // Settling up part of it from Balances, then removing that payment
  await go(alex, '/balances')
  const miloRow = alex.locator('li', { hasText: 'Milo' }).filter({ has: alex.getByRole('button', { name: 'Mark sent' }) }).first()
  const owedToMilo = async () => money(alex)(miloRow.locator('span.tabular-nums').first())
  const start = await owedToMilo()
  await miloRow.getByRole('button', { name: 'Mark sent' }).first().click(); await pause(alex, 300)
  check(await dialog(alex, 'Mark sent to Milo').count() === 1, 'Mark sent on Balances opens the settle-up dialog')
  await alex.getByLabel('Amount').fill('5')
  await alex.getByLabel('Note (optional)').fill('Live test') // so the fixture can clear it if a run stops halfway
  await modal(alex).getByRole('button', { name: 'Save' }).click(); await pause(alex, 2500)
  check(Math.abs(start - (await owedToMilo()) - 5) < 0.02, `a $5 partial payment takes $5 off ($${start} → $${await owedToMilo()})`)
  await alex.locator('section', { hasText: 'Payment history' }).locator('button', { hasText: 'Milo' }).first().click(); await pause(alex, 300)
  await alex.getByRole('button', { name: 'Remove this payment' }).first().click(); await pause(alex, 300)
  await modal(alex).getByRole('button', { name: 'Remove' }).click(); await pause(alex, 2500)
  check(Math.abs((await owedToMilo()) - start) < 0.02, 'removing that payment puts it back')

  // One receipt's "Mark sent" in the expanded row asks first
  await miloRow.locator('div.cursor-pointer').first().click({ position: { x: 20, y: 15 } }); await pause(alex, 300) // the name side (the amount doesn't toggle)
  const openRow = alex.locator('div', { has: alex.locator('a', { hasText: 'Live Check' }) }).filter({ has: alex.getByRole('button', { name: 'Mark sent' }) }).last()
  check(await openRow.count() === 1, 'expanding Milo lists Live Check with its own Mark sent')
  await openRow.getByRole('button', { name: 'Mark sent' }).click(); await pause(alex, 300)
  check(await dialog(alex, 'Mark as sent?').count() === 1 && (await modal(alex).innerText()).includes('Live Check'), '…which asks first, naming the receipt')
  await modal(alex).getByRole('button', { name: 'Mark sent' }).click(); await pause(alex, 2500)
  check(sql(`select count(*) from payments where receipt_id = '${R.check}' and deleted_at is null`) === '1', '…then records a payment for that receipt')
  sql(`update payments set deleted_at = now() where receipt_id = '${R.check}'`)

  // Switching groups: only the group you're in updates your screen
  sql(`insert into groups (id, name) values ('e2e10000-0000-4000-8000-0000000000f2', 'Live Second Group'); insert into group_members (group_id, user_id, first_name, last_name, role) select 'e2e10000-0000-4000-8000-0000000000f2', user_id, 'Alex', 'Test', 'owner' from group_members where id = ${member('Alex')}`)
  await go(alex, '/'); await alex.reload(); await pause(alex, 3000)
  await alex.getByRole('button', { name: 'Account menu' }).click(); await pause(alex, 300)
  await alex.getByRole('menuitemradio', { name: 'Live Second Group' }).click(); await pause(alex, 3500)
  sql(`insert into receipts (group_id, store_name, receipt_date, paid_by_member, member_ids) values (${GROUP}, 'Live In The Other Group', '2026-10-22', ${member('Milo')}, array[${member('Milo')}, ${member('Alex')}]); insert into items (receipt_id, name, price) select id, 'X', 1 from receipts where store_name = 'Live In The Other Group'`)
  const g2Alex = `(select id from group_members where group_id = 'e2e10000-0000-4000-8000-0000000000f2')`
  sql(`insert into receipts (group_id, store_name, receipt_date, paid_by_member, member_ids) values ('e2e10000-0000-4000-8000-0000000000f2', 'Live Second Receipt', '2026-10-22', ${g2Alex}, array[${g2Alex}]); insert into items (receipt_id, name, price) select id, 'Y', 1 from receipts where store_name = 'Live Second Receipt'`)
  check(await waitFor(async () => (await text(alex)).includes('Live Second Receipt')), "in the second group, its new receipt shows up by itself")
  check(!(await text(alex)).includes('Live In The Other Group'), "…and the first group's doesn't")
  await alex.getByRole('button', { name: 'Account menu' }).click(); await pause(alex, 300)
  await alex.getByRole('menuitemradio', { name: 'The Coolest Apt' }).click(); await pause(alex, 3500)
  check((await text(alex)).includes('Live In The Other Group') && !(await text(alex)).includes('Live Second Receipt'), 'switching back shows the first group, up to date')
  sql(`insert into receipts (group_id, store_name, receipt_date, paid_by_member, member_ids) values (${GROUP}, 'Live After Switching Back', '2026-10-22', ${member('Milo')}, array[${member('Milo')}, ${member('Alex')}]); insert into items (receipt_id, name, price) select id, 'Z', 1 from receipts where store_name = 'Live After Switching Back'`)
  check(await waitFor(async () => (await text(alex)).includes('Live After Switching Back')), '…and it updates live again')
}

// ── Removed from the group ───────────────────────────────────
{
  console.log('\nRemoved from the group')
  await go(alex, '/')
  sql(`update group_members set active = false where id = ${member('Alex')}`)
  check(await waitFor(async () => await dialog(alex, "You're no longer in The Coolest Apt").count() === 1),
    'someone removed while the app is open is told so, by itself')
  sql(`update group_members set active = true where id = ${member('Alex')}`)
}

await browser.close()
check(errors.length === 0, `no page errors${errors.length ? `:\n  ${errors.join('\n  ')}` : ''}`)
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
