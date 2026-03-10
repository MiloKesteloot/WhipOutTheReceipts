/**
 * Calculate debts from items + claims.
 *
 * Returns an array of { debtor, creditor, amount } objects.
 * Unclaimed items fall entirely on the payer.
 *
 * @param {Array} receipts  - [{ id, paid_by, store_name }]
 * @param {Array} items     - [{ id, receipt_id, name, price }]
 * @param {Array} claims    - [{ item_id, roommate }]
 */
export function calculateDebts(receipts, items, claims) {
  // Map receipt_id -> paid_by
  const payerByReceipt = {}
  for (const r of receipts) {
    payerByReceipt[r.id] = r.paid_by
  }

  // Map item_id -> [roommate]
  const claimesByItem = {}
  for (const c of claims) {
    if (!claimesByItem[c.item_id]) claimesByItem[c.item_id] = []
    claimesByItem[c.item_id].push(c.roommate)
  }

  // Accumulate raw debts: debtor -> creditor -> cents
  const rawDebts = {}

  for (const item of items) {
    const payer = payerByReceipt[item.receipt_id]
    const claimers = claimesByItem[item.id] || []
    const priceInCents = Math.round(item.price * 100)

    if (claimers.length === 0) {
      // Unclaimed — payer absorbs it, no debt created
      continue
    }

    const share = Math.floor(priceInCents / claimers.length)
    let remainder = priceInCents - share * claimers.length

    for (const debtor of claimers) {
      if (debtor === payer) continue // payer doesn't owe themselves

      let owes = share
      if (remainder > 0) {
        owes += 1
        remainder -= 1
      }

      if (!rawDebts[debtor]) rawDebts[debtor] = {}
      rawDebts[debtor][payer] = (rawDebts[debtor][payer] || 0) + owes
    }
  }

  // Convert cents back to dollars
  const debts = []
  for (const [debtor, creditors] of Object.entries(rawDebts)) {
    for (const [creditor, cents] of Object.entries(creditors)) {
      if (cents > 0) {
        debts.push({ debtor, creditor, amount: cents / 100 })
      }
    }
  }

  return debts
}

/**
 * Per-person itemized breakdown of what they owe and why.
 *
 * @returns Map: roommate -> [{ itemName, storeName, payer, share }]
 */
export function getItemizedBreakdown(receipts, items, claims) {
  const payerByReceipt = {}
  const storeByReceipt = {}
  for (const r of receipts) {
    payerByReceipt[r.id] = r.paid_by
    storeByReceipt[r.id] = r.store_name
  }

  const claimesByItem = {}
  for (const c of claims) {
    if (!claimesByItem[c.item_id]) claimesByItem[c.item_id] = []
    claimesByItem[c.item_id].push(c.roommate)
  }

  const breakdown = {}

  for (const item of items) {
    const payer = payerByReceipt[item.receipt_id]
    const store = storeByReceipt[item.receipt_id]
    const claimers = claimesByItem[item.id] || []
    if (claimers.length === 0) continue

    const share = item.price / claimers.length

    for (const roommate of claimers) {
      if (roommate === payer) continue
      if (!breakdown[roommate]) breakdown[roommate] = []
      breakdown[roommate].push({
        itemName: item.name,
        storeName: store,
        payer,
        share,
      })
    }
  }

  return breakdown
}
