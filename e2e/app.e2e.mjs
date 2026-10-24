// Browser tests: drives the real app (phone and desktop sizes) against the
// local UI-testing stack. They change its data, so start from a fresh copy:
//
//   npm run ui:start        (once; needs Docker)
//   npm run ui:reset        (fresh data: wipes the UI-testing database)
//   npm run ui:dev          (in another terminal: the app on :5180)
//   npm run test:e2e
//
// Each check prints ok/FAIL; the run ends with the number that failed.
// Afterwards, reset again before running supabase/tests/security_test.sql:
// this adds a person to the group that test counts.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'

const BASE = 'http://localhost:5180/WhipOutTheReceipts/'
const DB_URL = 'postgresql://postgres:postgres@host.docker.internal:54422/postgres'
const INVITE = '348U9RQ5' // the original group, "The Coolest Apt"
const DINER = 'e2e00000-0000-4000-8000-000000000001'
const MARKET = 'e2e00000-0000-4000-8000-000000000002'
const CORNER = 'e2e00000-0000-4000-8000-000000000003'
const PHONE = { viewport: { width: 384, height: 832 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const DESKTOP = { viewport: { width: 1200, height: 900 } }

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ── Helpers ──────────────────────────────────────────────────
function sql(file) {
  execFileSync('docker', ['run', '--rm', '-v', `${root}:/w`, 'postgres:17-alpine',
    'psql', DB_URL, '-q', '-v', 'ON_ERROR_STOP=1', '-f', `/w/${file}`],
  { stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } })
}

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

const hash = page => new URL(page.url()).hash
const pause = (page, ms = 600) => page.waitForTimeout(ms)
const dialog = (page, title) => page.locator(`h2:has-text("${title}")`)
// Pages are reached by tapping, like a person would: entries typed straight
// into the address bar aren't in the app's history (Back can't be checked)
async function tapTab(page, name) { await page.getByRole('link', { name, exact: true }).last().click(); await pause(page, 1500) }
async function openReceiptsList(page) {
  await tapTab(page, 'Receipts')
  await page.getByRole('button', { name: 'Receipts', exact: true }).click(); await pause(page)
}

// ── Setup ────────────────────────────────────────────────────
sql('e2e/fixtures.sql')

// ── Back buttons and history ─────────────────────────────────
{
  console.log('\nBack buttons')
  const page = await open(PHONE, 'milo@test.local')
  await page.goto(BASE + '#/'); await page.reload(); await pause(page, 2500)
  await openReceiptsList(page)
  await page.locator('div.divide-y > a').first().click(); await pause(page, 1500)
  const receipt = hash(page)
  check(/^#\/receipt\//.test(receipt), 'a receipt opens from the list')
  await page.getByRole('button', { name: '← Back' }).first().click(); await pause(page)
  check(hash(page) === '#/receipts', 'Back from a receipt returns to the list')

  await page.locator('div.divide-y > a').first().click(); await pause(page, 1500)
  await page.getByTitle('Edit receipt').click(); await pause(page, 1500)
  await page.getByRole('button', { name: '← Back' }).first().click(); await pause(page)
  check(hash(page) === receipt, 'Back from the editor returns to the receipt')
  await page.getByRole('button', { name: '← Back' }).first().click(); await pause(page)
  check(hash(page) === '#/receipts', '…and Back again skips the editor')

  await tapTab(page, 'Home')
  await page.locator('a[href="#/receipt/new"]').last().click(); await pause(page, 1200)
  await page.getByRole('button', { name: '← Back' }).first().click(); await pause(page)
  check(hash(page) === '#/', 'Back from an untouched new receipt goes home without asking')
  await page.context().close()
}

// ── Lists keep their place ───────────────────────────────────
{
  console.log('\nLists')
  const page = await open(PHONE, 'milo@test.local')
  await page.goto(BASE + '#/'); await page.reload(); await pause(page, 2500)
  await openReceiptsList(page)
  await page.getByRole('button', { name: 'All', exact: true }).click(); await pause(page)
  const all = await page.locator('div.divide-y > a').count()
  const row = page.locator('div.divide-y > a').nth(14)
  await row.scrollIntoViewIfNeeded()
  const y = await page.evaluate(() => window.scrollY)
  await row.click(); await pause(page, 1500)
  check(await page.evaluate(() => window.scrollY) === 0, 'a receipt opens at the top')
  await page.getByRole('button', { name: '← Back' }).first().click(); await pause(page, 1500)
  check(Math.abs(await page.evaluate(() => window.scrollY) - y) < 5, 'Back returns to the same place in the list')
  check(await page.locator('div.divide-y > a').count() === all, '"All" is still picked')
  await page.context().close()
}

// ── Unsaved work ─────────────────────────────────────────────
{
  console.log('\nUnsaved work')
  const page = await open(PHONE, 'milo@test.local')
  await page.goto(BASE + '#/'); await page.reload(); await pause(page, 2500)
  await openReceiptsList(page)
  await page.locator('div.divide-y > a').first().click(); await pause(page, 2000)
  const receipt = hash(page)
  await page.locator('ul li.cursor-pointer').first().click(); await pause(page, 300)
  await page.getByRole('link', { name: 'Stats' }).last().click(); await pause(page)
  check(await dialog(page, 'Unsaved changes').count() === 1 && hash(page) === receipt, 'the tab bar asks before dropping check-offs')
  await page.getByRole('button', { name: 'Stay' }).click(); await pause(page, 300)
  await page.goBack(); await pause(page)
  check(await dialog(page, 'Unsaved changes').count() === 1 && hash(page) === receipt, 'so does the back gesture')
  await page.getByRole('button', { name: 'Leave' }).click(); await pause(page)
  check(hash(page) === '#/receipts', 'Leave goes')

  await tapTab(page, 'Home')
  await page.locator('a[href="#/receipt/new"]').last().click(); await pause(page, 1500)
  await page.locator('input[placeholder="Item name"]').first().fill('Milk')
  await page.locator('nav a[href="#/"]').first().click(); await pause(page)
  check(await dialog(page, 'Unsaved changes').count() === 1, 'leaving a half-typed receipt by the logo asks')
  await page.getByRole('button', { name: 'Leave' }).click(); await pause(page)
  await page.context().close()
}

// ── Receipt form on a phone ──────────────────────────────────
{
  console.log('\nReceipt form')
  const page = await open(PHONE, 'milo@test.local')
  await page.goto(BASE + '#/receipt/new'); await pause(page, 2000)
  check(await page.evaluate(() => document.activeElement?.tagName) !== 'INPUT', "the keyboard doesn't pop up on open")
  await page.evaluate(() => { window.__submits = 0; window.addEventListener('submit', () => window.__submits++, true) })
  const name = page.locator('input[placeholder="Item name"]').first()
  const price = page.locator('input[placeholder="0.00"]').first()
  await name.fill('Milk'); await name.press('Enter')
  check(await page.evaluate(() => window.__submits) === 0 && await page.evaluate(() => document.activeElement?.getAttribute('placeholder')) === '0.00',
    'Enter moves from the item name to its price without saving')
  check(await price.getAttribute('inputmode') === 'decimal', 'prices use the decimal keypad')
  check(await page.evaluate(() => [...document.querySelectorAll('input:not([type=checkbox]), select')]
    .filter(el => el.offsetParent && parseFloat(getComputedStyle(el).fontSize) < 16).length) === 0, 'no field is small enough to make iPhones zoom in')
  await price.fill('5')
  const sign = page.getByRole('button', { name: 'Make negative (discount)' }).first()
  await sign.click()
  check(await price.inputValue() === '-5', '± makes a price negative')
  await sign.click()
  check(await price.inputValue() === '5', 'and positive again')
  await page.locator('button[type=submit]').click(); await pause(page, 800)
  check(await page.getByText('Some fields need fixing').count() === 1, 'saving with a missing store name says so')
  check(await page.evaluate(() => document.activeElement?.getAttribute('placeholder')) === 'e.g. Costco', '…and puts you on the store name')
  await page.context().close()

  const desk = await open(DESKTOP, 'milo@test.local')
  await desk.goto(BASE + '#/receipt/new'); await pause(desk, 2000)
  check(await desk.getByRole('button', { name: 'Make negative (discount)' }).first().isVisible() === false, 'no ± on desktop (the keyboard has a minus key)')
  check(await desk.locator('input[placeholder="Item name"]').first().evaluate(el => getComputedStyle(el).fontSize) === '14px', 'desktop fields keep their size')
  await desk.context().close()
}

// ── Calendar ─────────────────────────────────────────────────
{
  console.log('\nCalendar')
  const page = await open(PHONE, 'milo@test.local')
  await page.evaluate(() => { sessionStorage.setItem('receipts-calendar-month', JSON.stringify({ year: 2026, month: 2 })); sessionStorage.setItem('receipts-show-all', 'all') })
  await page.goto(BASE + '#/receipts'); await page.reload(); await pause(page, 2500)
  await page.getByRole('button', { name: 'Calendar', exact: true }).click(); await pause(page)
  const heights = await page.evaluate(() => [...new Set([...document.querySelectorAll('.grid-cols-7.divide-x > div')].map(el => Math.round(el.getBoundingClientRect().height)))])
  check(heights.length === 1, `every day is the same height on a phone (${heights.join(', ')}px)`)
  check(await page.getByText('+2 more').count() === 1, 'a day with three receipts shows one and "+2 more"')
  await tapTab(page, 'Balances'); await page.goBack(); await pause(page, 1500)
  check(await page.getByText('March 2026').count() === 1, 'coming back keeps the month')
  await page.context().close()
}

// ── Meals on the receipt page ────────────────────────────────
{
  console.log('\nMeals')
  const page = await open(PHONE, 'milo@test.local')
  await page.goto(BASE + `#/receipt/${DINER}`); await pause(page, 2500)
  // Milo has Pizza slice checked (fixtures.sql), not Garlic knots
  const item = name => page.locator('li', { hasText: name }).locator('input[type=checkbox]')
  const rowsBefore = await page.locator('ul > li').count()
  await page.locator('li', { hasText: 'Pizza' }).filter({ has: page.getByRole('button', { name: 'Check off all of Pizza' }) }).click({ position: { x: 200, y: 20 } }); await pause(page, 300)
  check(await page.locator('ul > li').count() === rowsBefore + 2 && await item('Pizza slice').isChecked() && !await item('Garlic knots').isChecked(),
    'tapping a meal opens it without changing check-offs')
  await page.getByRole('button', { name: 'Check off all of Pizza' }).click(); await pause(page, 300)
  check(await item('Pizza slice').isChecked() && await item('Garlic knots').isChecked(), "the meal's checkbox checks all its items")
  check(await page.getByText('includes $1.00 fee').count() === 1, 'the meal shows its fee')
  await page.context().close()
}

// ── Paying and undoing ───────────────────────────────────────
{
  console.log('\nPayments')
  const page = await open(PHONE, 'milo@test.local')
  await page.goto(BASE + `#/receipt/${MARKET}`); await pause(page, 2500)
  await page.getByRole('button', { name: 'Mark sent' }).click(); await pause(page, 1500)
  check(await page.getByRole('button', { name: '✓ Sent' }).count() === 1, 'Mark sent records the payment')
  await page.getByRole('button', { name: '✓ Sent' }).click(); await pause(page, 300)
  check(await dialog(page, 'Undo this payment?').count() === 1, 'undoing asks first')
  await page.getByRole('button', { name: 'Remove payment' }).click(); await pause(page, 1500)
  check(await page.getByRole('button', { name: 'Mark sent' }).count() === 1, 'and Remove takes it back')
  await page.context().close()
}

// ── Delete, search, restore ──────────────────────────────────
{
  console.log('\nDelete and restore')
  const page = await open(PHONE, 'milo@test.local')
  await page.goto(BASE + '#/'); await page.reload(); await pause(page, 2500)
  // What Alex owes Milo on Balances (E2E Corner adds $3.00 to it)
  const alexOwes = async () => {
    await tapTab(page, 'Balances')
    const section = page.locator('div.rounded-xl', { has: page.locator('h2', { hasText: 'People who owe you' }) })
    const text = await section.locator('li', { hasText: 'Alex' }).first().innerText()
    return Number(text.match(/\$([\d.]+)/)[1])
  }
  const owedBefore = await alexOwes()
  await tapTab(page, 'Receipts')
  await page.fill('input[type=search]', 'E2E Corner'); await pause(page, 1500)
  check(await page.locator('a[href="#/receipt/' + CORNER + '"]').count() > 0, 'search finds the receipt')
  await page.locator('a[href="#/receipt/' + CORNER + '"]').first().click(); await pause(page, 2000)
  await page.getByTitle('Delete receipt').click(); await page.getByRole('button', { name: 'Delete', exact: true }).click(); await pause(page, 1500)
  await page.fill('input[type=search]', ''); await page.fill('input[type=search]', 'E2E Corner'); await pause(page, 2000)
  check(await page.locator('a[href="#/receipt/' + CORNER + '"]').count() === 0, "search doesn't show it after deleting")
  const owedDeleted = await alexOwes()
  check(Math.abs(owedBefore - owedDeleted - 3) < 0.005, `a deleted receipt leaves the balances ($${owedBefore} → $${owedDeleted})`)
  await page.goto(BASE + `#/receipt/${CORNER}`); await pause(page, 2500)
  check(await page.getByText('✓ Paid').count() === 0, "a deleted receipt's debts don't show as paid")
  check(await page.getByRole('button', { name: 'Mark received' }).count() === 1, '(it shows as still owed)')
  await page.getByRole('button', { name: 'Restore' }).click(); await pause(page, 2000)
  check(Math.abs(await alexOwes() - owedBefore) < 0.005, 'restoring puts it back in the balances')
  await page.context().close()
}

// ── Group page ───────────────────────────────────────────────
{
  console.log('\nGroup page')
  const page = await open(PHONE, 'milo@test.local')
  await page.goto(BASE + '#/group'); await pause(page, 2500)
  const menus = page.getByRole('button', { name: 'More actions' })
  await menus.nth(0).click(); await menus.nth(3).click(); await pause(page, 200)
  check(await page.locator('[role=menu]').count() === 1, 'opening a second ⋯ menu closes the first')
  await page.mouse.click(30, 300); await pause(page, 200)
  check(await page.locator('[role=menu]').count() === 0, 'tapping elsewhere closes it')
  const row = page.locator('li', { hasText: 'Clouey' }).first()
  // Mid-screen, so its menu isn't under the top bar (scrolling closes it)
  await row.evaluate(e => e.scrollIntoView({ block: 'center' })); await pause(page, 200)
  await row.getByRole('button', { name: 'More actions' }).click(); await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.locator('input[placeholder="First name"]').fill('Typo')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await row.getByRole('button', { name: 'More actions' }).click(); await page.getByRole('menuitem', { name: 'Rename' }).click()
  check(await page.locator('input[placeholder="First name"]').inputValue() === 'Clouey', 'Rename after Cancel starts from the real name')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.context().close()
}

// ── Stats ────────────────────────────────────────────────────
{
  console.log('\nStats')
  const page = await open(PHONE, 'milo@test.local')
  await page.goto(BASE + '#/'); await page.reload(); await pause(page, 2500)
  await tapTab(page, 'Stats'); await pause(page, 1500)
  // The first chart (cumulative spending): its x axis labels
  const ticks = await page.evaluate(() => [...document.querySelectorAll('.recharts-wrapper')[0].querySelectorAll('[class*=xAxis] text')].map(t => t.textContent))
  check(ticks.length >= 2 && ticks.length <= 5 && ticks.every(t => /^[A-Z][a-z]{2} ('\d\d|\d{1,2})$/.test(t)),
    `the spending chart shows a few dates (${ticks.join(', ')})`)
  const chip = () => page.locator('section').first().locator('button').nth(1)
  const before = await chip().getAttribute('class')
  await chip().click(); await pause(page, 300)
  const after = await chip().getAttribute('class')
  await tapTab(page, 'Home'); await tapTab(page, 'Stats'); await pause(page, 1500)
  check(before !== after && await chip().getAttribute('class') === after, 'a person you toggled stays toggled')
  await chip().click() // put it back
  await page.context().close()
}

// ── Guest link ───────────────────────────────────────────────
{
  console.log('\nGuest link')
  const page = await open(DESKTOP, 'milo@test.local')
  await page.goto(BASE + '#/group'); await pause(page, 2500)
  await page.locator('li', { hasText: 'Clouey' }).first().getByRole('button', { name: 'Guest link' }).click()
  const make = page.getByRole('button', { name: 'Make a guest link' })
  if (await make.count()) { await make.click(); await pause(page, 1500) }
  const link = await page.locator('input[readonly][value*="#/guest/"]').first().inputValue()
  await page.context().close()

  const guest = await open(PHONE)
  // Opened fresh, like tapping the link in a message
  await guest.goto(link); await guest.reload(); await pause(guest, 2500)
  check(await guest.getByText('Hi, Clouey').count() === 1, 'the guest link opens for Clouey, signed out')
  const diner = guest.getByRole('button', { name: /E2E Diner/ })
  check(await diner.getByText(/Waiting on/).count() === 0, "a receipt Clouey hasn't checked shows no amount yet")
  await diner.click(); await pause(guest, 800)
  check(/\?r=/.test(guest.url()), 'the open receipt is in the address')
  const names = await guest.locator('ul p.text-sm.font-medium').allTextContents()
  const order = ['Soda', 'Pizza slice', 'Garlic knots', 'Wings basket'].map(n => names.findIndex(t => t.includes(n)))
  check(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), `items are grouped under their meals (${names.map(t => t.replace(/[^\w ]/g, '').trim()).join(', ')})`)
  await guest.getByRole('checkbox', { name: /Soda/ }).click(); await pause(guest, 200)
  await guest.goBack(); await pause(guest)
  check(await dialog(guest, 'Unsaved changes').count() === 1, 'the back gesture asks before dropping check-offs')
  await guest.getByRole('button', { name: 'Stay' }).click()
  await guest.getByRole('button', { name: 'Save' }).click(); await pause(guest, 2500)
  check(!/\?r=/.test(guest.url()) && await guest.getByText('Saved ✓').count() === 1, 'saving goes back to the list')
  check(await guest.getByRole('button', { name: /E2E Diner/ }).getByText('Waiting on Alex').count() === 1, 'until everyone checks in, it says who it is waiting on')
  await guest.context().close()
}

// ── Sign-up and sign-in ──────────────────────────────────────
{
  console.log('\nSign-up and sign-in')
  const page = await open(PHONE)
  await page.goto(BASE + '#/signup'); await pause(page, 1500)
  await page.fill('input[placeholder="First name"]', 'Milo')
  await page.fill('input[type=email]', 'milo@test.local')
  await page.fill('input[type=password]', 'whatever123')
  await page.getByRole('button', { name: 'Create account' }).click(); await pause(page, 2500)
  check(await page.getByText(/already/i).count() > 0, 'signing up with a taken email says so')

  await page.goto(BASE + '#/balances'); await pause(page, 1200)
  await page.goto(BASE + '#/signin'); await pause(page, 1200)
  await page.fill('input[type=email]', 'milo@test.local'); await page.fill('input[type=password]', 'test1234'); await page.keyboard.press('Enter')
  await pause(page, 3500)
  check(hash(page) === '#/balances', 'signing in returns to the link you opened')
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click(); await pause(page, 1500)
  check(hash(page) === '#/' && await page.getByText('Who can see our receipts?').count() === 1, 'signing out lands on the start page')
  await page.context().close()
}

// ── A new group, and joining with a taken name ───────────────
{
  console.log('\nNew group and joining')
  const page = await open(PHONE, 'newbie@test.local')
  await page.fill('input[placeholder="e.g. 4th Street Apartment"]', 'E2E Flat')
  await page.getByRole('button', { name: 'Create group' }).click(); await pause(page, 2500)
  await page.goto(BASE + '#/'); await pause(page, 2000)
  check(await page.getByText('Welcome to E2E Flat').count() === 1 && await page.getByRole('link', { name: 'Add your first receipt' }).count() === 1,
    'a new group gets "Add your first receipt"')
  check((await page.getByLabel('Invite link').inputValue()).includes('#/join/'), '…and the invite link to send')
  await tapTab(page, 'Stats')
  check(await page.getByText('No stats yet').count() === 1, 'Stats explains it has nothing yet')

  // Newbie Test → "Alex" with no last name, then join the group that has Alex Test
  await page.goto(BASE + '#/settings'); await pause(page, 2000)
  await page.locator('input[placeholder="First name"]').first().fill('Alex')
  await page.locator('input[placeholder="Last name"]').first().fill('')
  await page.getByRole('button', { name: 'Save' }).first().click(); await pause(page, 1500)
  await page.goto(BASE + `#/join/${INVITE}`); await pause(page, 2500)
  await page.getByRole('button', { name: "I'm new here" }).click(); await pause(page, 500)
  check(await page.getByText('already has someone called Alex Test').count() === 1, 'joining as a second Alex asks for a last name, and says why')
  await page.locator('input[placeholder="Last name"]').fill('Test')
  await page.getByRole('button', { name: 'Save and join' }).click(); await pause(page, 2500)
  check(await page.getByText('still taken').count() === 1, 'the exact same name is still refused')
  await page.locator('input[placeholder="Last name"]').fill('Moore')
  await page.getByRole('button', { name: 'Save and join' }).click(); await pause(page, 3500)
  check(hash(page) === '#/' && await page.getByText('The Coolest Apt').count() > 0, 'a different last name joins the group')

  // Two groups now: switching with unsaved check-offs asks first
  await page.goto(BASE + `#/receipt/${DINER}`); await pause(page, 2500)
  await page.locator('ul li.cursor-pointer').first().click(); await pause(page, 300)
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitemradio', { name: 'E2E Flat' }).click(); await pause(page, 300)
  check(await dialog(page, 'Switch group?').count() === 1, 'switching groups with unsaved check-offs asks first')
  await page.getByRole('button', { name: 'Stay' }).click()
  await page.context().close()
}

await browser.close()
check(errors.length === 0, `no page errors${errors.length ? `:\n  ${errors.join('\n  ')}` : ''}`)
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED')
process.exit(failed ? 1 : 0)
