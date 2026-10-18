import { useCallback, useEffect, useState } from 'react'
import { useGroup } from './group.jsx'
import { loadReceipts, loadItems, loadClaims, loadMeals, loadCheckins, loadPayments } from './db.js'
import { receiptDebts, computeBalances } from './balances.js'

// Loads the current group's receipts + payments and computes who owes whom.
// Returns { loading, error, data, debts, balances, reload }.
export function useBalances() {
  const { group, nameOf, memberIds } = useGroup()
  const [state, setState] = useState({ loading: true })

  const reload = useCallback(async () => {
    try {
      await load()
    } catch (error) {
      setState(prev => ({ ...prev, loading: false, error }))
    }
  }, [group.id, nameOf])

  async function load() {
    const [receipts, items, claims, meals, checkins, payments] = await Promise.all([
      loadReceipts(group.id, nameOf, 'id, paid_by_member, member_ids, store_name, receipt_date, created_at, tip, tax, fees'),
      loadItems(group.id, 'id, receipt_id, meal_id, price'),
      loadClaims(memberIds, nameOf),
      loadMeals(group.id, 'id, receipt_id, fee'),
      loadCheckins(memberIds, nameOf),
      loadPayments(group.id, nameOf),
    ])
    const data = { receipts, items, claims, meals, checkins, payments }
    const debts = receiptDebts(data)
    setState({ loading: false, error: null, data, debts, balances: computeBalances(debts, payments) })
  }

  useEffect(() => { reload() }, [reload])
  return { ...state, reload }
}
