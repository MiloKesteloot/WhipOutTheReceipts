// One-time conversion: old per-receipt "settlements" → payments (amounts).
//
//   node scripts/migrate-settlements-to-payments.mjs <db-url>           # dry run
//   node scripts/migrate-settlements-to-payments.mjs <db-url> --apply   # write
//
// Run after migration 20261017020000_payments.sql. Safe to re-run: each
// payment remembers the settlement it came from.
//
// Rules: duplicate settlements for the same receipt + pair collapse into one.
// A settlement with an amount becomes a payment of that amount. One with no
// amount meant "fully paid", so it becomes a payment of that receipt's debt.
import { execFileSync } from 'child_process'
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { calculateDebts } from '../src/lib/splitLogic.js'
import { receiptDebts, computeBalances } from '../src/lib/balances.js'

const [dbUrl, flag] = process.argv.slice(2)
if (!dbUrl) { console.error('Usage: node scripts/migrate-settlements-to-payments.mjs <db-url> [--apply]'); process.exit(1) }
const apply = flag === '--apply'
const env = { ...process.env, MSYS_NO_PATHCONV: '1' }

function query(sql) {
  const out = execFileSync('docker', ['run', '--rm', 'postgres:17-alpine', 'psql', dbUrl, '-Atc', `select coalesce(json_agg(t), '[]') from (${sql}) t`],
    { env, maxBuffer: 1e9 }).toString()
  return JSON.parse(out)
}

const receipts = query('select id, group_id, paid_by_member, member_ids, store_name, receipt_date, tip, tax, fees from receipts where deleted_at is null')
// Same order the app loads them in (by id): leftover pennies in a split go
// to whoever's claim comes first, so order affects the exact cents
const items = query('select id, receipt_id, meal_id, price from items where deleted_at is null order by id')
const claims = query('select item_id, member_id from claims order by id')
const meals = query('select id, receipt_id, fee from meals where deleted_at is null')
const checkins = query('select receipt_id, member_id from checkins')
const settlements = query('select * from settlements order by settled_at')
const existing = new Set(query('select imported_from_settlement as id from payments where imported_from_settlement is not null').map(r => r.id))

// Page shape, using member ids as names (they're unique)
const pageReceipts = receipts.map(r => ({ ...r, paid_by: r.paid_by_member, members: r.member_ids }))
const pageClaims = claims.map(c => ({ ...c, roommate: c.member_id }))
const pageCheckins = checkins.map(c => ({ ...c, roommate: c.member_id }))
const receiptById = Object.fromEntries(pageReceipts.map(r => [r.id, r]))

function debtOn(receiptId, debtor, creditor) {
  const r = receiptById[receiptId]
  if (!r) return 0
  const rItems = items.filter(i => i.receipt_id === receiptId)
  const ids = new Set(rItems.map(i => i.id))
  const d = calculateDebts([r], rItems, pageClaims.filter(c => ids.has(c.item_id)), meals.filter(m => m.receipt_id === receiptId))
    .find(x => x.debtor === debtor && x.creditor === creditor)
  return d ? d.amount : 0
}

// Collapse duplicates per receipt + pair
const groups = new Map()
for (const s of settlements) {
  const key = `${s.receipt_id}|${s.debtor_member}|${s.creditor_member}`
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(s)
}

const payments = []
const skipped = []
for (const rows of groups.values()) {
  const first = rows[0]
  const debt = debtOn(first.receipt_id, first.debtor_member, first.creditor_member)
  const stored = Math.max(...rows.map(r => Number(r.amount ?? 0)))
  // Amounts recorded by the old app can be a few cents off today's debt
  // (rounding before duplicate names were merged); those meant "paid in full"
  const anyFull = rows.some(r => r.amount == null) || Math.abs(stored - debt) <= 0.05
  const amount = anyFull ? debt : stored
  const paidAt = rows.map(r => r.settled_at || r.created_at).sort().at(-1)
  if (!(amount > 0)) { skipped.push({ ...first, reason: anyFull ? 'no debt on that receipt anymore' : 'zero amount' }); continue }
  payments.push({
    settlementId: first.id, groupId: first.group_id, from: first.debtor_member, to: first.creditor_member,
    amount: Math.round(amount * 100) / 100, receiptId: first.receipt_id, paidAt,
  })
}

// Balances before (old rule: any settlement marks that receipt+pair paid) vs after
const debts = receiptDebts({ receipts: pageReceipts, items, claims: pageClaims, meals, checkins: pageCheckins })
const settledKeys = new Set(settlements.map(s => `${s.receipt_id}|${s.debtor_member}|${s.creditor_member}`))
const before = new Map()
for (const d of debts) {
  if (settledKeys.has(`${d.receiptId}|${d.debtor}|${d.creditor}`)) continue
  const key = [d.debtor, d.creditor].sort().join('|')
  const sign = d.debtor < d.creditor ? 1 : -1
  before.set(key, (before.get(key) || 0) + sign * d.cents)
}
const after = computeBalances(debts, payments.map(p => ({ ...p })))
const names = Object.fromEntries(query('select id, first_name from group_members').map(m => [m.id, m.first_name]))
const diffs = []
const allKeys = new Set([...before.keys(), ...debts.map(d => [d.debtor, d.creditor].sort().join('|')), ...payments.map(p => [p.from, p.to].sort().join('|'))])
for (const key of allKeys) {
  const [a, b] = key.split('|')
  const beforeCents = before.get(key) || 0 // >0: a owes b
  const aView = after.forPerson(a).find(x => x.person === b)
  const afterCents = aView ? Math.round(aView.amount * 100) * (aView.iOwe ? 1 : -1) : 0
  if (beforeCents !== afterCents) diffs.push({ a: names[a], b: names[b], before: beforeCents / 100, after: afterCents / 100 })
}

console.log(`${settlements.length} settlements → ${groups.size} receipt+pair groups → ${payments.length} payments (${skipped.length} skipped)`)
for (const s of skipped) console.log(`  skipped: ${names[s.debtor_member]} → ${names[s.creditor_member]} on ${receiptById[s.receipt_id]?.store_name || s.receipt_id}: ${s.reason}`)
console.log(`Balance check (positive = first person owes second):`)
if (!diffs.length) console.log('  every pair is unchanged')
for (const d of diffs) console.log(`  ${d.a} ↔ ${d.b}: before ${d.before.toFixed(2)}, after ${d.after.toFixed(2)}`)

const toInsert = payments.filter(p => !existing.has(p.settlementId))
if (!apply) { console.log(`\nDry run: would insert ${toInsert.length} payments. Re-run with --apply to write.`); process.exit(0) }

const esc = v => v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`
const sql = ['begin;', "set local app.skip_audit = 'on';",
  ...toInsert.map(p => `insert into public.payments (group_id, from_member, to_member, amount, receipt_id, note, paid_at, created_by, imported_from_settlement)
    values (${esc(p.groupId)}, ${esc(p.from)}, ${esc(p.to)}, ${p.amount}, ${esc(p.receiptId)}, 'Marked sent before payment amounts were tracked', ${esc(p.paidAt)}, null, ${esc(p.settlementId)})
    on conflict (imported_from_settlement) do nothing;`),
  'commit;'].join('\n')
const dir = mkdtempSync(join(tmpdir(), 'payments-'))
const file = join(dir, 'import.sql')
writeFileSync(file, sql)
execFileSync('docker', ['run', '--rm', '-v', `${dir}:/w`, 'postgres:17-alpine', 'psql', dbUrl, '-q', '-v', 'ON_ERROR_STOP=1', '-f', '/w/import.sql'], { env, stdio: 'inherit' })
unlinkSync(file)
console.log(`Inserted ${toInsert.length} payments.`)
