/**
 * Receipts created before this moment keep the rounding they were settled
 * with: the old split could hand the others an extra cent of tax/tip and
 * give the payer's leftover cent to someone else. Fixing it everywhere
 * would leave a few cents "owed" on receipts people already paid off.
 * Set to null to use the corrected rounding for every receipt.
 */
export const ROUNDING_FIX_FROM = '2026-10-18T10:31:37Z'
const createdBefore = (receipt, moment) =>
  !!(moment && receipt?.created_at && Date.parse(receipt.created_at) < Date.parse(moment))
const usesOldRounding = receipt => createdBefore(receipt, ROUNDING_FIX_FROM)

/**
 * Receipts created before this moment split tax/tip/fees over claimed
 * items only, so the people who claimed something also paid the fee share
 * of unclaimed items. From here on the payer keeps that share, along with
 * the unclaimed items. Set to null to apply it to every receipt.
 */
export const UNCLAIMED_FEES_FIX_FROM = '2026-10-18T20:45:00Z'

// The old item split: the payer was skipped before taking a leftover cent
function oldSplitItemCents(price, claimers, payer) {
  const priceInCents = Math.round(price * 100)
  const share = Math.floor(priceInCents / claimers.length)
  let rem = priceInCents - share * claimers.length
  return claimers.map(person => {
    if (person === payer) return [person, share]
    let cents = share
    if (rem > 0) { cents += 1; rem -= 1 }
    return [person, cents]
  })
}

// The old proportional split: leftover cents were handed out among the
// non-payers only, even when the payer's share caused them
function oldDistributeProportionally(feeCents, relevantItems, claimsByItem, payer) {
  if (!feeCents) return {}
  const effectiveByPerson = {}
  for (const item of relevantItems) {
    const claimers = claimsByItem[item.id] || []
    if (claimers.length === 0) continue
    for (const [person, cents] of splitItemCents(item.price, claimers)) {
      effectiveByPerson[person] = (effectiveByPerson[person] || 0) + cents
    }
  }
  const totalEffective = Object.values(effectiveByPerson).reduce((s, v) => s + v, 0)
  if (!totalEffective) return {}
  const shares = Object.entries(effectiveByPerson).filter(([p]) => p !== payer).map(([person, effective]) => ({
    person, share: Math.floor(feeCents * effective / totalEffective), effective,
  }))
  let remainder = feeCents - shares.reduce((s, e) => s + e.share, 0)
  const frac = e => (feeCents * e.effective / totalEffective) - Math.floor(feeCents * e.effective / totalEffective)
  shares.sort((a, b) => frac(b) - frac(a))
  for (const e of shares) {
    if (remainder <= 0) break
    e.share += 1
    remainder -= 1
  }
  const result = {}
  for (const { person, share } of shares) if (share > 0) result[person] = share
  return result
}

// Item split and proportional split for this receipt (old rounding for old receipts)
const itemSplit = (receipt, price, claimers) =>
  usesOldRounding(receipt) ? oldSplitItemCents(price, claimers, receipt.paid_by) : splitItemCents(price, claimers)
const proportional = (receipt, ...args) =>
  usesOldRounding(receipt)
    ? oldDistributeProportionally(...args)
    : distributeProportionally(...args, !createdBefore(receipt, UNCLAIMED_FEES_FIX_FROM))

/**
 * Split an item's price between its claimers, in cents. Leftover cents go
 * to the first claimers, payer included, so every view of a receipt (who
 * owes what, the breakdown, tax shares) splits it the same way.
 * Returns [[person, cents], ...] in claimer order.
 */
export function splitItemCents(price, claimers) {
  const priceInCents = Math.round(price * 100)
  const share = Math.floor(priceInCents / claimers.length)
  let rem = priceInCents - share * claimers.length
  return claimers.map(person => {
    let cents = share
    if (rem > 0) { cents += 1; rem -= 1 }
    return [person, cents]
  })
}

/**
 * Distribute an amount (in cents) proportionally to what each claimer of
 * the given items had, then leave out the payer (their part is theirs).
 * Leftover cents are handed out over everyone, payer included, so the
 * others never pick up extra cents for the payer's share.
 * With payerTakesUnclaimed, unclaimed items count as the payer's, so their
 * part of the fee stays with the payer too.
 * Returns: { person -> cents }
 */
function distributeProportionally(feeCents, relevantItems, claimsByItem, payer, payerTakesUnclaimed = false) {
  if (!feeCents) return {}

  // Each person's effective cents = sum of their split shares of items they claimed
  const effectiveByPerson = {}
  for (const item of relevantItems) {
    const claimers = claimsByItem[item.id] || []
    if (claimers.length === 0) {
      if (payerTakesUnclaimed) effectiveByPerson[payer] = (effectiveByPerson[payer] || 0) + Math.round(item.price * 100)
      continue
    }
    for (const [person, cents] of splitItemCents(item.price, claimers)) {
      effectiveByPerson[person] = (effectiveByPerson[person] || 0) + cents
    }
  }

  const totalEffective = Object.values(effectiveByPerson).reduce((s, v) => s + v, 0)
  if (totalEffective <= 0) return {}

  const shares = Object.entries(effectiveByPerson).map(([person, effective], order) => {
    const exact = feeCents * effective / totalEffective
    return { person, share: Math.floor(exact), frac: exact - Math.floor(exact), order }
  })

  // Leftover cents to the largest fractional parts (ties: claimer order)
  let remainder = feeCents - shares.reduce((s, e) => s + e.share, 0)
  for (const s of [...shares].sort((a, b) => b.frac - a.frac || a.order - b.order)) {
    if (remainder <= 0) break
    s.share += 1
    remainder -= 1
  }

  const result = {}
  for (const { person, share } of shares) {
    if (person !== payer && share > 0) result[person] = share
  }
  return result
}

function distributeTipTaxFees(receipt, receiptItems, claimsByItem) {
  const cents = Math.round(((receipt.tip || 0) + (receipt.tax || 0) + (receipt.fees || 0)) * 100)
  return proportional(receipt, cents, receiptItems, claimsByItem, receipt.paid_by)
}

/**
 * Calculate debts from items + claims + tip/tax + meal fees.
 *
 * Returns an array of { debtor, creditor, amount } objects.
 * Unclaimed items fall entirely on the payer.
 * Tip and tax are distributed proportionally to each person's item share;
 * the share of unclaimed items stays with the payer (see UNCLAIMED_FEES_FIX_FROM).
 * Meal fees are distributed the same way over the items in that meal.
 *
 * @param {Array} receipts  - [{ id, paid_by, tip, tax }]
 * @param {Array} items     - [{ id, receipt_id, meal_id, name, price }]
 * @param {Array} claims    - [{ item_id, roommate }]
 * @param {Array} meals     - [{ id, receipt_id, fee }]  (optional)
 */
export function calculateDebts(receipts, items, claims, meals = []) {
  const payerByReceipt = {}
  const receiptById = {}
  for (const r of receipts) { payerByReceipt[r.id] = r.paid_by; receiptById[r.id] = r }

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

  const itemsByMeal = {}
  for (const item of items) {
    if (item.meal_id) {
      if (!itemsByMeal[item.meal_id]) itemsByMeal[item.meal_id] = []
      itemsByMeal[item.meal_id].push(item)
    }
  }

  const rawDebts = {}

  // Item debts
  for (const item of items) {
    const payer = payerByReceipt[item.receipt_id]
    const claimers = claimsByItem[item.id] || []
    if (claimers.length === 0) continue

    for (const [debtor, owes] of itemSplit(receiptById[item.receipt_id], item.price, claimers)) {
      if (debtor === payer) continue
      if (!rawDebts[debtor]) rawDebts[debtor] = {}
      rawDebts[debtor][payer] = (rawDebts[debtor][payer] || 0) + owes
    }
  }

  // Tip + tax debts
  for (const receipt of receipts) {
    const payer = receipt.paid_by
    const shares = distributeTipTaxFees(receipt, itemsByReceipt[receipt.id] || [], claimsByItem)
    for (const [debtor, cents] of Object.entries(shares)) {
      if (!rawDebts[debtor]) rawDebts[debtor] = {}
      rawDebts[debtor][payer] = (rawDebts[debtor][payer] || 0) + cents
    }
  }

  // Meal fee debts
  for (const meal of meals) {
    const feeCents = Math.round((meal.fee || 0) * 100)
    if (!feeCents) continue
    const payer = payerByReceipt[meal.receipt_id]
    if (!payer) continue
    const mealItems = itemsByMeal[meal.id] || []
    const shares = proportional(receiptById[meal.receipt_id], feeCents, mealItems, claimsByItem, payer)
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
 * Includes tip & tax and meal fees as line items where applicable.
 *
 * @returns Map: roommate -> [{ itemName, storeName, payer, share }]
 */
export function getItemizedBreakdown(receipts, items, claims, meals = []) {
  const receiptById = Object.fromEntries(receipts.map(r => [r.id, r]))
  const payerByReceipt = {}
  const storeByReceipt = {}
  const tipTaxByReceipt = {}
  for (const r of receipts) {
    payerByReceipt[r.id] = r.paid_by
    storeByReceipt[r.id] = r.store_name
    tipTaxByReceipt[r.id] = { tip: r.tip || 0, tax: r.tax || 0, fees: r.fees || 0 }
  }

  const claimsByItem = {}
  for (const c of claims) {
    if (!claimsByItem[c.item_id]) claimsByItem[c.item_id] = []
    claimsByItem[c.item_id].push(c.roommate)
  }

  const itemsByReceipt = {}
  const itemsByMeal = {}
  for (const item of items) {
    if (!itemsByReceipt[item.receipt_id]) itemsByReceipt[item.receipt_id] = []
    itemsByReceipt[item.receipt_id].push(item)
    if (item.meal_id) {
      if (!itemsByMeal[item.meal_id]) itemsByMeal[item.meal_id] = []
      itemsByMeal[item.meal_id].push(item)
    }
  }

  const breakdown = {}

  for (const item of items) {
    const payer = payerByReceipt[item.receipt_id]
    const store = storeByReceipt[item.receipt_id]
    const claimers = claimsByItem[item.id] || []
    if (claimers.length === 0) continue
    for (const [roommate, cents] of itemSplit(receiptById[item.receipt_id], item.price, claimers)) {
      if (roommate === payer) continue
      if (!breakdown[roommate]) breakdown[roommate] = []
      breakdown[roommate].push({ itemName: item.name, storeName: store, payer, share: cents / 100 })
    }
  }

  // Tip + tax + fees lines per receipt per person
  for (const receipt of receipts) {
    const { tip, tax, fees } = tipTaxByReceipt[receipt.id]
    if (!tip && !tax && !fees) continue
    const label = [tip > 0 && 'Tip', tax > 0 && 'Tax', fees > 0 && 'Fees'].filter(Boolean).join(' & ')
    const store = storeByReceipt[receipt.id]
    const payer = receipt.paid_by
    const shares = distributeTipTaxFees(receipt, itemsByReceipt[receipt.id] || [], claimsByItem)
    for (const [person, cents] of Object.entries(shares)) {
      if (!breakdown[person]) breakdown[person] = []
      breakdown[person].push({ itemName: label, storeName: store, payer, share: cents / 100 })
    }
  }

  // Meal fee lines
  for (const meal of meals) {
    const feeCents = Math.round((meal.fee || 0) * 100)
    if (!feeCents) continue
    const payer = payerByReceipt[meal.receipt_id]
    const store = storeByReceipt[meal.receipt_id]
    if (!payer) continue
    const mealItems = itemsByMeal[meal.id] || []
    const shares = proportional(receiptById[meal.receipt_id], feeCents, mealItems, claimsByItem, payer)
    for (const [person, cents] of Object.entries(shares)) {
      if (!breakdown[person]) breakdown[person] = []
      breakdown[person].push({ itemName: `${meal.name} fee`, storeName: store, payer, share: cents / 100 })
    }
  }

  return breakdown
}
