// Balances between people = receipt debts − payments.
// Pure functions (no React/Supabase) so pages and scripts share them.
import { calculateDebts } from './splitLogic.js'

const lc = s => String(s || '').toLowerCase()
const toCents = n => Math.round(Number(n || 0) * 100)

/**
 * Debts from receipts that count toward balances. A receipt only counts
 * once everyone on it has checked in.
 * All inputs in page shape (names): receipts {id, paid_by, members, store_name,
 * receipt_date, tip, tax, fees}, items, claims {item_id, roommate}, meals, checkins {receipt_id, roommate}.
 * Returns [{ receiptId, label, date, debtor, creditor, cents }].
 */
export function receiptDebts({ receipts, items, claims, meals = [], checkins = [] }) {
  const itemsByReceipt = {}
  for (const i of items) (itemsByReceipt[i.receipt_id] ||= []).push(i)
  const claimsByItem = {}
  for (const c of claims) (claimsByItem[c.item_id] ||= []).push(c)
  const mealsByReceipt = {}
  for (const m of meals) (mealsByReceipt[m.receipt_id] ||= []).push(m)
  const checkedIn = {}
  for (const c of checkins) (checkedIn[c.receipt_id] ||= new Set()).add(lc(c.roommate))

  const out = []
  for (const r of receipts) {
    const rItems = itemsByReceipt[r.id] || []
    if (!rItems.length) continue
    const members = (r.members || []).map(lc)
    if (members.length && !members.every(m => checkedIn[r.id]?.has(m))) continue
    const rClaims = rItems.flatMap(i => claimsByItem[i.id] || [])
    for (const d of calculateDebts([r], rItems, rClaims, mealsByReceipt[r.id] || [])) {
      out.push({
        receiptId: r.id,
        label: r.store_name || 'Receipt',
        date: r.receipt_date || '',
        debtor: d.debtor,
        creditor: d.creditor,
        cents: toCents(d.amount),
      })
    }
  }
  return out
}

/**
 * Net balance and open (still unpaid) debts for every pair of people.
 * payments: [{ id, from, to, amount, receiptId, paidAt }] in names.
 *
 * Within a pair, the debts in the owing direction are covered by
 * everything that offsets them (payments that way, debts the other way,
 * minus payments the other way). Coverage goes first to receipts a
 * payment named, then oldest receipt first. What's left is "open", and
 * the open amounts always add up to the net balance.
 */
export function computeBalances(debts, payments) {
  const pairs = new Map()
  const pairFor = (a, b) => {
    const key = [lc(a), lc(b)].sort().join('|')
    if (!pairs.has(key)) pairs.set(key, { names: {}, debts: [], payments: [] })
    const p = pairs.get(key)
    p.names[lc(a)] = a
    p.names[lc(b)] = b
    return p
  }
  for (const d of debts) pairFor(d.debtor, d.creditor).debts.push(d)
  for (const p of payments) pairFor(p.from, p.to).payments.push({ ...p, cents: toCents(p.amount) })

  const result = new Map()
  for (const [key, p] of pairs) {
    const [x, y] = key.split('|')
    const sum = (arr, from, to) => arr
      .filter(e => lc(e.debtor ?? e.from) === from && lc(e.creditor ?? e.to) === to)
      .reduce((s, e) => s + e.cents, 0)
    // net > 0: x owes y
    const net = sum(p.debts, x, y) - sum(p.debts, y, x) - sum(p.payments, x, y) + sum(p.payments, y, x)
    const [debtor, creditor] = net > 0 ? [x, y] : [y, x]
    const owed = Math.abs(net)

    const owingDebts = p.debts
      .filter(d => lc(d.debtor) === debtor && lc(d.creditor) === creditor)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .map(d => ({ ...d, remaining: d.cents }))
    let pool = owingDebts.reduce((s, d) => s + d.cents, 0) - owed
    // Negative pool: part of the balance comes from payments alone (e.g. an
    // overpayment), not from any receipt
    const fromPayments = Math.max(0, -pool)
    pool = Math.max(0, pool)

    // Payments that named a receipt cover that receipt first
    const linked = {}
    for (const pay of p.payments) {
      if (pay.receiptId && lc(pay.from) === debtor && lc(pay.to) === creditor) {
        linked[pay.receiptId] = (linked[pay.receiptId] || 0) + pay.cents
      }
    }
    for (const d of owingDebts) {
      const c = Math.min(d.remaining, linked[d.receiptId] || 0, pool)
      if (c > 0) { d.remaining -= c; linked[d.receiptId] -= c; pool -= c }
    }
    // Then oldest first
    for (const d of owingDebts) {
      const c = Math.min(d.remaining, pool)
      if (c > 0) { d.remaining -= c; pool -= c }
    }

    result.set(key, {
      debtor: owed ? p.names[debtor] : null,
      creditor: owed ? p.names[creditor] : null,
      cents: owed,
      open: owed ? owingDebts.filter(d => d.remaining > 0) : [],
      fromPayments: owed ? fromPayments : 0,
      payments: p.payments,
    })
  }

  return {
    // Everyone `name` has a non-zero balance with
    forPerson(name) {
      const me = lc(name)
      const out = []
      for (const [key, b] of result) {
        if (!b.cents || !key.split('|').includes(me)) continue
        const iOwe = lc(b.debtor) === me
        out.push({ person: iOwe ? b.creditor : b.debtor, iOwe, amount: b.cents / 100, open: b.open, fromPayments: b.fromPayments / 100 })
      }
      return out
    },
    // How much of one receipt's debt is still unpaid
    remainingFor(receiptId, debtor, creditor) {
      const b = result.get([lc(debtor), lc(creditor)].sort().join('|'))
      if (!b || lc(b.debtor) !== lc(debtor)) return 0
      const d = b.open.find(o => o.receiptId === receiptId)
      return d ? d.remaining / 100 : 0
    },
  }
}
