import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useGroup } from './group.jsx'
import { loadReceipts, loadItems, loadClaims, loadMeals, loadCheckins, loadPayments, loadDismissals, loadNotices } from './db.js'
import { receiptDebts, computeBalances } from './balances.js'
import { onLive, touchesTables } from './live.js'
import { whenIdle } from './idle.js'

// The current group's receipts + payments and who owes whom, shared by
// every page that shows them (Home, Receipts, Balances, a receipt), so
// they load once and stay in step.
//
// - The last loaded data per group is kept, so coming Back to a page shows
//   it straight away (and at the same scroll position) instead of
//   "Loading…" first.
// - Live updates load it again. The new data is applied once you're not
//   mid-tap (lib/idle.js); a reload you asked for (after your own save)
//   applies at once.
// - Only the newest load may update the page (an older, slower one is
//   dropped).

const TABLES = ['receipts', 'items', 'meals', 'claims', 'checkins', 'payments', 'item_dismissals', 'receipt_notices', 'group_members']

const stores = new Map()

function storeFor(groupId) {
  if (!stores.has(groupId)) {
    stores.set(groupId, { state: { loading: true }, listeners: new Set(), latest: 0, load: null, unsubscribeLive: null })
  }
  return stores.get(groupId)
}

function setState(store, next) {
  store.state = next
  for (const fn of store.listeners) fn()
}

// Load now; `live` waits to apply until you're not mid-tap
function reloadStore(groupId, { live = false } = {}) {
  const store = storeFor(groupId)
  if (!store.load) return Promise.resolve()
  const request = ++store.latest
  return store.load().then(next => {
    if (request !== store.latest) return
    const apply = () => { if (request === store.latest) setState(store, next) }
    if (live) whenIdle(`balances-${groupId}`, apply)
    else apply()
  }, error => {
    if (request !== store.latest) return
    setState(store, { ...store.state, loading: false, error })
  })
}

// Returns { loading, error, data, debts, balances, reload }
export function useBalances() {
  const { group, nameOf, memberIds } = useGroup()
  const store = storeFor(group.id)

  // The loader uses the latest names and member list (people join, get renamed)
  store.load = async () => {
    const [receipts, items, claims, meals, checkins, payments, dismissals, notices] = await Promise.all([
      loadReceipts(group.id, nameOf, 'id, paid_by_member, member_ids, store_name, category, receipt_date, created_at, tip, tax, fees, splits_unclaimed, version'),
      loadItems(group.id, 'id, receipt_id, meal_id, name, price, always_split, position, created_at'),
      loadClaims(memberIds, nameOf),
      loadMeals(group.id, 'id, receipt_id, name, fee, created_at'),
      loadCheckins(memberIds, nameOf),
      loadPayments(group.id, nameOf),
      loadDismissals(memberIds, nameOf),
      loadNotices(memberIds, nameOf),
    ])
    const data = { receipts, items, claims, meals, checkins, payments, dismissals, notices }
    const debts = receiptDebts(data)
    return { loading: false, error: null, data, debts, balances: computeBalances(debts, payments) }
  }

  const state = useSyncExternalStore(
    useCallback(fn => { store.listeners.add(fn); return () => store.listeners.delete(fn) }, [store]),
    () => store.state,
  )

  // Load on open (showing what's kept meanwhile), and listen for live
  // updates while any page is using it
  const key = memberIds.join(',')
  useEffect(() => { reloadStore(group.id) }, [group.id, key, nameOf])
  useEffect(() => {
    if (!store.unsubscribeLive) {
      store.unsubscribeLive = onLive(batch => {
        if (touchesTables(batch, TABLES)) reloadStore(group.id, { live: true })
      })
    }
    return () => {
      // Last page using it gone: stop listening (the data is kept)
      queueMicrotask(() => {
        if (store.listeners.size === 0 && store.unsubscribeLive) { store.unsubscribeLive(); store.unsubscribeLive = null }
      })
    }
  }, [store, group.id])

  const reload = useCallback(() => reloadStore(group.id), [group.id])
  return { ...state, reload }
}
