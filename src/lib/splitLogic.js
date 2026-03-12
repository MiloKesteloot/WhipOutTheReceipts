/**
 * Distribute an amount (in cents) proportionally among claimers of the given items,
 * excluding the payer. Returns: { person -> cents }
 */
function distributeProportionally(feeCents, relevantItems, claimsByItem, payer) {
  if (!feeCents) return {}

  // Each person's effective cents = sum of their split shares of items they claimed
  const effectiveByPerson = {}
  for (const item of relevantItems) {
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
    share: Math.floor(feeCents * effective / totalEffective),
    effective,
  }))

  // Distribute remainder cents to those with largest fractional parts
  const distributed = shares.reduce((s, e) => s + e.share, 0)
  let remainder = feeCents - distributed
  shares.sort((a, b) => {
    const aFrac = (feeCents * a.effective / totalEffective) - Math.floor(feeCents * a.effective / totalEffective)
    const bFrac = (feeCents * b.effective / totalEffective) - Math.floor(feeCents * b.effective / totalEffective)
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

function distributeTipTaxFees(receipt, receiptItems, claimsByItem) {
  const cents = Math.round(((receipt.tip || 0) + (receipt.tax || 0) + (receipt.fees || 0)) * 100)
  return distributeProportionally(cents, receiptItems, claimsByItem, receipt.paid_by)
}

/**
 * Calculate debts from items + claims + tip/tax + meal fees.
 *
 * Returns an array of { debtor, creditor, amount } objects.
 * Unclaimed items fall entirely on the payer.
 * Tip and tax are distributed proportionally to each person's claimed item share.
 * Meal fees are distributed proportionally among claimers of items in that meal.
 *
 * @param {Array} receipts  - [{ id, paid_by, tip, tax }]
 * @param {Array} items     - [{ id, receipt_id, meal_id, name, price }]
 * @param {Array} claims    - [{ item_id, roommate }]
 * @param {Array} meals     - [{ id, receipt_id, fee }]  (optional)
 */
export function calculateDebts(receipts, items, claims, meals = []) {
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
    const shares = distributeProportionally(feeCents, mealItems, claimsByItem, payer)
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
    const shares = distributeProportionally(feeCents, mealItems, claimsByItem, payer)
    for (const [person, cents] of Object.entries(shares)) {
      if (!breakdown[person]) breakdown[person] = []
      breakdown[person].push({ itemName: `${meal.name} fee`, storeName: store, payer, share: cents / 100 })
    }
  }

  return breakdown
}
