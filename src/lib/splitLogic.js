/**
 * Distribute tip+tax for a receipt proportionally among non-payer claimers,
 * weighted by each person's split share of claimed items.
 * Returns: { person -> cents }
 */
function distributeTipTax(receipt, receiptItems, claimsByItem) {
  const tipTaxCents = Math.round(((receipt.tip || 0) + (receipt.tax || 0)) * 100)
  if (!tipTaxCents) return {}

  const payer = receipt.paid_by

  // Each person's effective cents = sum of their split shares of items they claimed
  const effectiveByPerson = {}
  for (const item of receiptItems) {
    const claimers = claimsByItem[item.id] || []
    if (claimers.length === 0) continue
    const priceInCents = Math.round(item.price * 100)
    const share = Math.floor(priceInCents / claimers.length)
    let rem = priceInCents - share * claimers.length
    for (const person of claimers) {
      let owes = share
      if (rem > 0) { owes += 1; rem -= 1 }
      effectiveByPerson[person] = (effectiveByPerson[person] || 0) + owes
    }
  }

  const totalEffective = Object.values(effectiveByPerson).reduce((s, v) => s + v, 0)
  if (!totalEffective) return {}

  // Distribute only among non-payer claimers
  const debtors = Object.entries(effectiveByPerson).filter(([p]) => p !== payer)

  const shares = debtors.map(([person, effective]) => ({
    person,
    share: Math.floor(tipTaxCents * effective / totalEffective),
    effective,
  }))

  // Distribute remainder cents to those with largest fractional parts
  const distributed = shares.reduce((s, e) => s + e.share, 0)
  let remainder = tipTaxCents - distributed
  shares.sort((a, b) => {
    const aFrac = (tipTaxCents * a.effective / totalEffective) - Math.floor(tipTaxCents * a.effective / totalEffective)
    const bFrac = (tipTaxCents * b.effective / totalEffective) - Math.floor(tipTaxCents * b.effective / totalEffective)
    return bFrac - aFrac
  })
  for (const s of shares) {
    if (remainder <= 0) break
    s.share += 1
    remainder -= 1
  }

  const result = {}
  for (const { person, share } of shares) {
    if (share > 0) result[person] = share
  }
  return result
}

/**
 * Calculate debts from items + claims + tip/tax.
 *
 * Returns an array of { debtor, creditor, amount } objects.
 * Unclaimed items fall entirely on the payer.
 * Tip and tax are distributed proportionally to each person's claimed item share.
 *
 * @param {Array} receipts  - [{ id, paid_by, tip, tax }]
 * @param {Array} items     - [{ id, receipt_id, name, price }]
 * @param {Array} claims    - [{ item_id, roommate }]
 */
export function calculateDebts(receipts, items, claims) {
  const payerByReceipt = {}
  for (const r of receipts) payerByReceipt[r.id] = r.paid_by

  const claimsByItem = {}
  for (const c of claims) {
    if (!claimsByItem[c.item_id]) claimsByItem[c.item_id] = []
    claimsByItem[c.item_id].push(c.roommate)
  }

  const itemsByReceipt = {}
  for (const item of items) {
    if (!itemsByReceipt[item.receipt_id]) itemsByReceipt[item.receipt_id] = []
    itemsByReceipt[item.receipt_id].push(item)
  }

  const rawDebts = {}

  // Item debts
  for (const item of items) {
    const payer = payerByReceipt[item.receipt_id]
    const claimers = claimsByItem[item.id] || []
    if (claimers.length === 0) continue

    const priceInCents = Math.round(item.price * 100)
    const share = Math.floor(priceInCents / claimers.length)
    let remainder = priceInCents - share * claimers.length

    for (const debtor of claimers) {
      if (debtor === payer) continue
      let owes = share
      if (remainder > 0) { owes += 1; remainder -= 1 }
      if (!rawDebts[debtor]) rawDebts[debtor] = {}
      rawDebts[debtor][payer] = (rawDebts[debtor][payer] || 0) + owes
    }
  }

  // Tip + tax debts
  for (const receipt of receipts) {
    const payer = receipt.paid_by
    const shares = distributeTipTax(receipt, itemsByReceipt[receipt.id] || [], claimsByItem)
    for (const [debtor, cents] of Object.entries(shares)) {
      if (!rawDebts[debtor]) rawDebts[debtor] = {}
      rawDebts[debtor][payer] = (rawDebts[debtor][payer] || 0) + cents
    }
  }

  const debts = []
  for (const [debtor, creditors] of Object.entries(rawDebts)) {
    for (const [creditor, cents] of Object.entries(creditors)) {
      if (cents > 0) debts.push({ debtor, creditor, amount: cents / 100 })
    }
  }
  return debts
}

/**
 * Per-person itemized breakdown of what they owe and why.
 * Includes tip & tax as a line item where applicable.
 *
 * @returns Map: roommate -> [{ itemName, storeName, payer, share }]
 */
export function getItemizedBreakdown(receipts, items, claims) {
  const payerByReceipt = {}
  const storeByReceipt = {}
  const tipTaxByReceipt = {}
  for (const r of receipts) {
    payerByReceipt[r.id] = r.paid_by
    storeByReceipt[r.id] = r.store_name
    tipTaxByReceipt[r.id] = { tip: r.tip || 0, tax: r.tax || 0 }
  }

  const claimsByItem = {}
  for (const c of claims) {
    if (!claimsByItem[c.item_id]) claimsByItem[c.item_id] = []
    claimsByItem[c.item_id].push(c.roommate)
  }

  const itemsByReceipt = {}
  for (const item of items) {
    if (!itemsByReceipt[item.receipt_id]) itemsByReceipt[item.receipt_id] = []
    itemsByReceipt[item.receipt_id].push(item)
  }

  const breakdown = {}

  for (const item of items) {
    const payer = payerByReceipt[item.receipt_id]
    const store = storeByReceipt[item.receipt_id]
    const claimers = claimsByItem[item.id] || []
    if (claimers.length === 0) continue
    const share = item.price / claimers.length
    for (const roommate of claimers) {
      if (roommate === payer) continue
      if (!breakdown[roommate]) breakdown[roommate] = []
      breakdown[roommate].push({ itemName: item.name, storeName: store, payer, share })
    }
  }

  // Tip + tax lines per receipt per person
  for (const receipt of receipts) {
    const { tip, tax } = tipTaxByReceipt[receipt.id]
    if (!tip && !tax) continue
    const label = [tip > 0 && 'Tip', tax > 0 && 'Tax'].filter(Boolean).join(' & ')
    const store = storeByReceipt[receipt.id]
    const payer = receipt.paid_by
    const shares = distributeTipTax(receipt, itemsByReceipt[receipt.id] || [], claimsByItem)
    for (const [person, cents] of Object.entries(shares)) {
      if (!breakdown[person]) breakdown[person] = []
      breakdown[person].push({ itemName: label, storeName: store, payer, share: cents / 100 })
    }
  }

  return breakdown
}
