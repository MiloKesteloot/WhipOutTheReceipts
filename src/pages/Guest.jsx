import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { computeDisplayNames } from '../lib/group.jsx'
import { calculateDebts } from '../lib/splitLogic.js'
import { receiptDebts, computeBalances } from '../lib/balances.js'
import { getItemEmoji } from '../lib/itemEmoji.js'
import { LOGO_URL } from '../lib/logo.js'
import { useGoBack } from '../lib/useGoBack.js'
import { useUnsavedChanges, leaveWithoutPrompt } from '../lib/unsaved.jsx'
import TornPaper from '../components/TornPaper.jsx'

// /guest/:token — check off items for someone without an account, from a
// link the group shared with them. No login: everything goes through the
// guest_view / guest_save_claims database functions, which only work for
// this one person (migration 20261018040000_guest_links.sql).

const fmtDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center gap-2 font-bold text-gray-900">
          <img src={LOGO_URL} alt="" width={28} height={28} className="w-7 h-7" />
          Receipts
        </div>
      </header>
      <main className="max-w-xl mx-auto px-4 py-6">{children}</main>
    </div>
  )
}

export default function Guest() {
  const { token } = useParams()
  const [view, setView] = useState(undefined) // undefined = loading, null = invalid link
  const [loadFailed, setLoadFailed] = useState(false)
  // The open receipt is in the address (?r=…), so the phone's back gesture
  // returns to the list instead of leaving the page
  const [params, setParams] = useSearchParams()
  const openId = params.get('r')
  const goBack = useGoBack()
  const { pathname } = useLocation()
  const openReceipt = id => setParams({ r: id })
  const closeReceipt = () => goBack(pathname)
  const [savedId, setSavedId] = useState(null)

  const load = useCallback(async () => {
    setLoadFailed(false)
    const { data, error } = await supabase.rpc('guest_view', { p_token: token })
    if (error) { setLoadFailed(true); return }
    setView(data ?? null)
  }, [token])

  useEffect(() => { load() }, [load])

  // Page-shape receipts (names instead of ids), like the rest of the app
  const shaped = useMemo(() => {
    if (!view) return null
    const names = computeDisplayNames(view.people)
    const nameOf = id => names.get(id) || 'Someone'
    const me = view.member.id
    const receipts = view.receipts.map(r => ({
      ...r,
      paid_by: nameOf(r.paid_by_member),
      members: (r.member_ids || []).map(nameOf),
      items: r.items.map(i => ({ ...i, receipt_id: r.id, price: Number(i.price) })),
      meals: r.meals.map(m => ({ ...m, receipt_id: r.id, fee: Number(m.fee) })),
      claims: r.claims.map(c => ({ ...c, roommate: nameOf(c.member_id) })),
      checkedIn: r.checkins.includes(me),
      waitingOn: (r.member_ids || []).filter(id => !r.checkins.includes(id)).map(nameOf),
      tip: Number(r.tip), tax: Number(r.tax), fees: Number(r.fees),
    }))
    // What's owed, like the Balances page: a receipt counts once everyone on
    // it has checked in, and payments are taken off
    const payments = (view.payments || []).map(p => ({
      id: p.id, from: nameOf(p.from_member), to: nameOf(p.to_member),
      amount: Number(p.amount), receiptId: p.receipt_id, paidAt: p.paid_at,
    }))
    const debts = receiptDebts({
      receipts,
      items: receipts.flatMap(r => r.items),
      claims: receipts.flatMap(r => r.claims),
      meals: receipts.flatMap(r => r.meals),
      checkins: receipts.flatMap(r => r.checkins.map(id => ({ receipt_id: r.id, roommate: nameOf(id) }))),
    })
    const balances = computeBalances(debts, payments)
    return { name: nameOf(me), meId: me, nameOf, receipts, balances }
  }, [view])

  if (loadFailed) {
    return (
      <Shell>
        <div className="text-center py-12">
          <p className="font-semibold text-gray-800">Couldn't load this page</p>
          <button onClick={load} className="mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-accent-600 text-white hover:bg-accent-700 transition">Try again</button>
        </div>
      </Shell>
    )
  }
  if (view === undefined) return <Shell><p className="text-sm text-gray-400">Loading…</p></Shell>
  if (view === null) {
    return (
      <Shell>
        <div className="text-center py-12">
          <p className="font-semibold text-gray-800">This link doesn't work anymore</p>
          <p className="text-sm text-gray-500 mt-1">It may have been replaced with a new one. Ask whoever sent it for a fresh link.</p>
        </div>
      </Shell>
    )
  }

  const open = shaped.receipts.find(r => r.id === openId)
  if (open) {
    return (
      <Shell>
        <ReceiptCheckOff
          receipt={open}
          token={token}
          guestName={shaped.name}
          onBack={closeReceipt}
          onSaved={async () => { await load(); setSavedId(open.id); leaveWithoutPrompt(); closeReceipt() }}
        />
      </Shell>
    )
  }

  const todo = shaped.receipts.filter(r => !r.checkedIn)
  const done = shaped.receipts.filter(r => r.checkedIn)
  const owed = shaped.balances.forPerson(shaped.name)
  const amountLabel = r => {
    if (r.paid_by === shaped.name) return null
    if (r.waitingOn.length) return <span className="text-xs text-gray-400">Waiting on {r.waitingOn.join(', ')}</span>
    const left = shaped.balances.remainingFor(r.id, shaped.name, r.paid_by)
    return left > 0
      ? <span className="text-sm font-semibold text-amber-600">${left.toFixed(2)}</span>
      : <span className="text-xs text-accent-600 font-medium">Paid ✓</span>
  }

  const row = r => (
    <li key={r.id}>
      <button onClick={() => { setSavedId(null); openReceipt(r.id) }} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 transition">
        <div className="min-w-0">
          <p className="font-medium text-gray-900 truncate">{r.store_name}</p>
          <p className="text-xs text-gray-400">{fmtDate(r.receipt_date)} · Paid by {r.paid_by === shaped.name ? 'you' : r.paid_by}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {r.checkedIn && amountLabel(r)}
          {savedId === r.id && <span className="text-xs text-accent-600 font-medium">Saved ✓</span>}
          <span className="text-gray-300">›</span>
        </div>
      </button>
    </li>
  )

  return (
    <Shell>
      <h1 className="text-2xl font-bold text-gray-900">Hi, {shaped.name}</h1>
      <p className="text-sm text-gray-500 mt-1">
        Check off what you had on {view.group.name}'s receipts, and Receipts works out what you owe.
      </p>

      {owed.length > 0 && (
        <ul className="mt-4 bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {owed.map(o => (
            <li key={o.person} className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="text-gray-700">{o.iOwe ? `You owe ${o.person}` : `${o.person} owes you`}</span>
              <span className={`font-semibold ${o.iOwe ? 'text-amber-600' : 'text-accent-600'}`}>${o.amount.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      )}

      {shaped.receipts.length === 0 && (
        <p className="mt-8 text-center text-sm text-gray-400">You're not on any receipts yet.</p>
      )}

      {todo.length > 0 && (
        <section className="mt-6 bg-white border border-amber-200 rounded-xl overflow-hidden">
          <h2 className="px-4 py-3 bg-amber-50 border-b border-amber-100 font-semibold text-amber-800">
            {todo.length === 1 ? '1 receipt to check off' : `${todo.length} receipts to check off`}
          </h2>
          <ul className="divide-y divide-gray-100">{todo.map(row)}</ul>
        </section>
      )}

      {done.length > 0 && (
        <section className="mt-6 bg-white border border-gray-200 rounded-xl overflow-hidden">
          <h2 className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-800">Checked off</h2>
          <ul className="divide-y divide-gray-100">{done.map(row)}</ul>
          <p className="px-4 py-2.5 border-t border-gray-100 text-xs text-gray-400">
            Amounts are what you still owe whoever paid. They're final once everyone on the receipt has checked off.
          </p>
        </section>
      )}
    </Shell>
  )
}

// One receipt: tick what you had, see your total, save
function ReceiptCheckOff({ receipt, token, guestName, onBack, onSaved }) {
  const mine = receipt.claims.filter(c => c.roommate === guestName).map(c => c.item_id)
  const locked = receipt.items.filter(i => i.always_split).map(i => i.id)
  // First visit: everything checked (like the app); after that, exactly what was saved
  const [checked, setChecked] = useState(() => new Set(
    receipt.checkedIn || mine.length ? [...mine, ...locked] : receipt.items.map(i => i.id),
  ))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [initial] = useState(() => [...checked].sort().join())
  const dirty = [...checked].sort().join() !== initial
  const unsavedDialog = useUnsavedChanges(dirty, "Your check-offs aren't saved yet. Leave without saving them?", { includeSearch: true })

  const toggle = item => {
    if (item.always_split) return
    setChecked(prev => {
      const next = new Set(prev)
      next.has(item.id) ? next.delete(item.id) : next.add(item.id)
      return next
    })
  }

  const claims = [
    ...receipt.claims.filter(c => c.roommate !== guestName),
    ...[...checked].map(item_id => ({ item_id, roommate: guestName })),
  ]
  const total = calculateDebts([receipt], receipt.items, claims, receipt.meals)
    .filter(d => d.debtor === guestName).reduce((s, d) => s + d.amount, 0)

  async function save() {
    setSaving(true); setError('')
    const { error } = await supabase.rpc('guest_save_claims', { p_token: token, p_receipt: receipt.id, p_item_ids: [...checked] })
    if (error) { setError(error.message); setSaving(false); return }
    await onSaved()
  }

  const mealName = Object.fromEntries(receipt.meals.map(m => [m.id, m.name]))
  const extras = receipt.tip + receipt.tax + receipt.fees
  // Items without a meal first, then each meal under its name (like the
  // receipt page), whatever order they were typed in
  const ordered = [
    ...receipt.items.filter(i => !i.meal_id),
    ...receipt.meals.flatMap(m => receipt.items.filter(i => i.meal_id === m.id)),
  ]
  let lastMeal

  return (
    <div className="pb-28">
      {unsavedDialog}
      <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-800 mb-3">← All receipts</button>
      <h1 className="text-2xl font-bold text-gray-900">{receipt.store_name}</h1>
      <p className="text-sm text-gray-400 mt-0.5">{fmtDate(receipt.receipt_date)} · Paid by {receipt.paid_by === guestName ? 'you' : receipt.paid_by}</p>
      <p className="text-sm text-gray-500 mt-3">Check off everything you had. Shared items are split between everyone who checks them.</p>

      <TornPaper className="mt-4">
      <ul className="tear-rows-nested divide-y divide-gray-100">
        {ordered.map(item => {
          const header = item.meal_id && item.meal_id !== lastMeal ? mealName[item.meal_id] : null
          lastMeal = item.meal_id
          const others = receipt.claims.filter(c => c.item_id === item.id && c.roommate !== guestName).map(c => c.roommate)
          return (
            <li key={item.id}>
              {header && <p className="px-4 pt-3 pb-1 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50">{header}</p>}
              <button onClick={() => toggle(item)} className={`w-full flex items-center gap-3 px-4 py-3 text-left ${item.always_split ? '' : 'hover:bg-gray-50'}`}>
                <input type="checkbox" readOnly checked={checked.has(item.id)} disabled={item.always_split} className="h-4 w-4 rounded accent-accent-600" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {item.name}
                    {getItemEmoji(item.name) && <span className="ml-1.5">{getItemEmoji(item.name)}</span>}
                    {item.always_split && <span className="ml-1.5 text-xs text-gray-400">🔒</span>}
                  </p>
                  {others.length > 0 && <p className="text-xs text-gray-400 truncate">{others.join(', ')}</p>}
                </div>
                <span className="text-sm font-medium text-gray-700 shrink-0">${item.price.toFixed(2)}</span>
              </button>
            </li>
          )
        })}
        {extras > 0 && (
          <li className="flex items-center gap-3 px-4 py-3 bg-gray-50/60">
            <span className="flex-1 text-sm text-gray-400">Tax, tip and fees · split by what each person had</span>
            <span className="text-sm text-gray-400">${extras.toFixed(2)}</span>
          </li>
        )}
      </ul>
      </TornPaper>

      {/* Your total + save, pinned to the bottom */}
      <div className="fixed bottom-0 left-0 right-0 p-4" style={{ paddingBottom: 'max(1rem, var(--safe-bottom))' }}>
        <div className="max-w-xl mx-auto bg-white border border-gray-200 shadow-lg rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-gray-400">{receipt.paid_by === guestName ? 'You paid for this one' : 'Your share'}</p>
            <p className="text-xl font-bold text-accent-600">${total.toFixed(2)}</p>
          </div>
          <button onClick={save} disabled={saving} className="px-5 py-2 bg-accent-600 text-white font-semibold rounded-xl hover:bg-accent-700 transition disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {error && <p className="max-w-xl mx-auto mt-2 text-sm text-red-500 text-center">{error}</p>}
      </div>
    </div>
  )
}
