import { useCallback, useEffect, useState } from 'react'
import { useGroup } from './group.jsx'
import { loadReceipts, loadItems, loadClaims, loadMeals, loadCheckins, loadPayments } from './db.js'
import { receiptDebts, computeBalances } from './balances.js'

// Loads the current group's receipts + payments and computes who owes whom.
// Returns { loading, data, debts, balances, reload }.
export function useBalances() {
  const { group, nameOf, memberIds } = useGroup()
  const [state, setState] = useState({ loading: true })

  const reload = useCallback(async () => {
    const [receipts, items, claims, meals, checkins, payments] = await Promise.all([
      loadReceipts(group.id, nameOf, 'id, paid_by_member, member_ids, store_name, receipt_date, tip, tax, fees', { datedOnly: true }),
      loadItems(group.id, 'id, receipt_id, meal_id, price'),
      loadClaims(memberIds, nameOf),
      loadMeals(group.id, 'id, receipt_id, fee'),
      loadCheckins(memberIds, nameOf),
      loadPayments(group.id, nameOf),
    ])
    const data = { receipts, items, claims, meals, checkins, payments }
    const debts = receiptDebts(data)
    setState({ loading: false, data, debts, balances: computeBalances(debts, payments) })
  }, [group.id, nameOf])

  useEffect(() => { reload() }, [reload])
  return { ...state, reload }
}
