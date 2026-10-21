// Per-receipt status shared by Home and the Receipts page: who's on it,
// who has checked in, and its total. Inputs are useBalances() data (names).

// Members plus the payer: the receipts that matter to you ("Mine"), since
// people owe the payer on it. Check-ins only wait on the members, like
// balances: a payer left off the list paid but had nothing themselves.
export function effectiveMembers(receipt) {
  const members = receipt.members || []
  const payer = receipt.paid_by
  if (!payer) return members
  if (members.some(m => m.toLowerCase() === payer.toLowerCase())) return members
  return [...members, payer]
}

export function isOnReceipt(receipt, name) {
  const members = effectiveMembers(receipt)
  return !name || members.length === 0 || members.some(m => m.toLowerCase() === name.toLowerCase())
}

// { receiptId: Set(lowercased names) } of everyone who checked in. Only
// check-ins count, like in balances: adding items to a receipt clears the
// others' check-ins but keeps their claims, and they need to check in again.
export function checkedInByReceipt({ checkins }) {
  const out = {}
  for (const checkin of checkins) {
    ;(out[checkin.receipt_id] ||= new Set()).add(checkin.roommate.toLowerCase())
  }
  return out
}

// { receiptId: total } = items + tip + tax + fees + meal fees
export function receiptTotals({ receipts, items, meals = [] }) {
  const itemSum = {}
  for (const i of items) itemSum[i.receipt_id] = (itemSum[i.receipt_id] || 0) + Number(i.price || 0)
  for (const m of meals) itemSum[m.receipt_id] = (itemSum[m.receipt_id] || 0) + Number(m.fee || 0)
  const out = {}
  for (const r of receipts) {
    out[r.id] = (itemSum[r.id] || 0) + Number(r.tip || 0) + Number(r.tax || 0) + Number(r.fees || 0)
  }
  return out
}

// Receipts I'm on, that have items, that I haven't checked off yet
export function receiptsToCheckOff({ receipts, items }, claimers, myName) {
  if (!myName) return []
  const me = myName.toLowerCase()
  const withItems = new Set(items.map(i => i.receipt_id))
  return receipts.filter(r =>
    (r.members || []).some(m => m.toLowerCase() === me)
    && withItems.has(r.id)
    && !claimers[r.id]?.has(me))
}

// Members who haven't checked in yet, once someone has started
export function waitingOn(receipt, claimers) {
  const c = claimers[receipt.id]
  if (!c || c.size === 0) return []
  return (receipt.members || []).filter(m => !c.has(m.toLowerCase()))
}
