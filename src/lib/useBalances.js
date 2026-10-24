import { useCallback, useEffect, useRef, useState } from 'react'
import { useGroup } from './group.jsx'
import { loadReceipts, loadItems, loadClaims, loadMeals, loadCheckins, loadPayments, loadDismissals } from './db.js'
import { receiptDebts, computeBalances } from './balances.js'

// The last loaded data per group, shown at once while it's fetched again.
// Coming Back to a page then shows it straight away (and at the same scroll
// position) instead of "Loading…" first.
const cache = new Map()

// Loads the current group's receipts + payments and computes who owes whom.
// Returns { loading, error, data, debts, balances, reload }.
export function useBalances() {
  const { group, nameOf, memberIds } = useGroup()
  const [state, setState] = useState(() => cache.get(group.id) || { loading: true })
  const latest = useRef(0)

  const reload = useCallback(async () => {
    // Only the newest request may update the page (an older, slower one is dropped)
    const request = ++latest.current
    try {
      const next = await load()
      if (request !== latest.current) return
      cache.set(group.id, next)
      setState(next)
    } catch (error) {
      if (request === latest.current) setState(prev => ({ ...prev, loading: false, error }))
    }
  }, [group.id, nameOf])

  async function load() {
    const [receipts, items, claims, meals, checkins, payments, dismissals] = await Promise.all([
      loadReceipts(group.id, nameOf, 'id, paid_by_member, member_ids, store_name, category, receipt_date, created_at, tip, tax, fees, splits_unclaimed'),
      loadItems(group.id, 'id, receipt_id, meal_id, name, price, always_split, position, created_at'),
      loadClaims(memberIds, nameOf),
      loadMeals(group.id, 'id, receipt_id, name, fee, created_at'),
      loadCheckins(memberIds, nameOf),
      loadPayments(group.id, nameOf),
      loadDismissals(memberIds, nameOf),
    ])
    const data = { receipts, items, claims, meals, checkins, payments, dismissals }
    const debts = receiptDebts(data)
    return { loading: false, error: null, data, debts, balances: computeBalances(debts, payments) }
  }

  useEffect(() => { reload() }, [reload])
  return { ...state, reload }
}
