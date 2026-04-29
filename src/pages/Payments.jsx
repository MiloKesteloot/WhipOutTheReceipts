import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { calculateDebts } from '../lib/splitLogic.js'

const toTitleCase = s => s.replace(/\b\w/g, c => c.toUpperCase())

const fmtDate = dateStr => {
  if (!dateStr) return null
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export default function Payments() {
  const myName = localStorage.getItem('global-name') || ''
  const myNameLc = myName.toLowerCase()

  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('sent')
  const [expanded, setExpanded] = useState(new Set())
  const [sentList, setSentList] = useState([])
  const [receivedList, setReceivedList] = useState([])

  useEffect(() => {
    if (myName) loadData()
  }, [myName])

  async function loadData() {
    const [settlementsRes, receiptsRes, itemsRes, claimsRes, mealsRes, tripsRes] = await Promise.all([
      supabase.from('settlements').select('*'),
      supabase.from('receipts').select('id, store_name, receipt_date, paid_by, tip, tax, fees'),
      supabase.from('items').select('id, receipt_id, price, meal_id'),
      supabase.from('claims').select('item_id, roommate'),
      supabase.from('meals').select('id, receipt_id, fee'),
      supabase.from('trips').select('id, name'),
    ])

    const allSettlements = settlementsRes.data || []
    const allReceipts = receiptsRes.data || []
    const allItems = itemsRes.data || []
    const allClaims = claimsRes.data || []
    const allMeals = mealsRes.data || []
    const allTrips = tripsRes.data || []

    const receiptById = Object.fromEntries(allReceipts.map(r => [r.id, r]))
    const tripById = Object.fromEntries(allTrips.map(t => [t.id, t]))

    const itemsByReceipt = {}
    for (const item of allItems) {
      if (!itemsByReceipt[item.receipt_id]) itemsByReceipt[item.receipt_id] = []
      itemsByReceipt[item.receipt_id].push(item)
    }

    const mealsByReceipt = {}
    for (const m of allMeals) {
      if (!mealsByReceipt[m.receipt_id]) mealsByReceipt[m.receipt_id] = []
      mealsByReceipt[m.receipt_id].push(m)
    }

    const mySettlements = allSettlements.filter(s =>
      s.debtor?.toLowerCase() === myNameLc || s.creditor?.toLowerCase() === myNameLc
    )

    // Group by other person
    const byPersonKey = {}

    for (const s of mySettlements) {
      const iAmDebtor = s.debtor?.toLowerCase() === myNameLc
      const otherRaw = iAmDebtor ? s.creditor : s.debtor
      if (!otherRaw) continue
      const otherKey = otherRaw.toLowerCase()

      if (!byPersonKey[otherKey]) byPersonKey[otherKey] = { name: toTitleCase(otherRaw), sent: [], received: [] }

      let amount = null
      let label = ''
      let date = null
      let linkTo = null
      let sublabel = null

      if (s.receipt_id) {
        const receipt = receiptById[s.receipt_id]
        if (!receipt) continue
        label = receipt.store_name || 'Receipt'
        date = receipt.receipt_date
        linkTo = `/receipt/${s.receipt_id}`

        // Compute the debt between these two people for this receipt
        const rItems = itemsByReceipt[receipt.id] || []
        const itemIds = new Set(rItems.map(i => i.id))
        const rClaims = allClaims.filter(c => itemIds.has(c.item_id))
        const rMeals = mealsByReceipt[receipt.id] || []
        const debts = calculateDebts([receipt], rItems, rClaims, rMeals)
        const debt = debts.find(d =>
          d.debtor.toLowerCase() === s.debtor.toLowerCase() &&
          d.creditor.toLowerCase() === s.creditor.toLowerCase()
        )
        amount = debt?.amount ?? null
      } else if (s.trip_id) {
        const trip = tripById[s.trip_id]
        label = trip?.name || 'Trip'
        sublabel = 'Trip'
        amount = s.amount ?? null
        linkTo = `/trip/${s.trip_id}`
      } else {
        continue
      }

      const entry = { label, sublabel, date, amount, linkTo }
      if (iAmDebtor) byPersonKey[otherKey].sent.push(entry)
      else byPersonKey[otherKey].received.push(entry)
    }

    const sortByDate = arr => [...arr].sort((a, b) => {
      if (!a.date && !b.date) return 0
      if (!a.date) return 1
      if (!b.date) return -1
      return b.date.localeCompare(a.date)
    })

    const built = { sent: [], received: [] }
    for (const { name, sent, received } of Object.values(byPersonKey)) {
      if (sent.length > 0) {
        const entries = sortByDate(sent)
        built.sent.push({ name, total: entries.reduce((s, e) => s + (e.amount || 0), 0), entries })
      }
      if (received.length > 0) {
        const entries = sortByDate(received)
        built.received.push({ name, total: entries.reduce((s, e) => s + (e.amount || 0), 0), entries })
      }
    }

    built.sent.sort((a, b) => b.total - a.total)
    built.received.sort((a, b) => b.total - a.total)
    setSentList(built.sent)
    setReceivedList(built.received)
    setLoading(false)
  }

  function toggleExpanded(key) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const activeList = tab === 'sent' ? sentList : receivedList
  const sentTotal = sentList.reduce((s, e) => s + e.total, 0)
  const receivedTotal = receivedList.reduce((s, e) => s + e.total, 0)

  if (loading) return <div className="max-w-2xl mx-auto p-8 text-gray-400">Loading…</div>

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Payment History</h1>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">You sent</p>
          <p className="text-2xl font-bold text-gray-900">${sentTotal.toFixed(2)}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            to {sentList.length} {sentList.length === 1 ? 'person' : 'people'}
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">You received</p>
          <p className="text-2xl font-bold text-accent-600">${receivedTotal.toFixed(2)}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            from {receivedList.length} {receivedList.length === 1 ? 'person' : 'people'}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5 mb-4 w-fit">
        {[
          ['sent', `Sent (${sentList.length})`],
          ['received', `Received (${receivedList.length})`],
        ].map(([v, label]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* List */}
      {activeList.length === 0 ? (
        <div className="py-16 text-center text-gray-400 text-sm">
          No {tab === 'sent' ? 'outgoing' : 'incoming'} payments recorded yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {activeList.map(({ name, total, entries }) => {
            const key = `${tab}-${name}`
            const open = expanded.has(key)
            const hasUnknown = entries.some(e => e.amount == null)
            return (
              <li key={key} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <button
                  onClick={() => toggleExpanded(key)}
                  className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                      tab === 'sent' ? 'bg-gray-100 text-gray-600' : 'bg-accent-100 text-accent-700'
                    }`}>
                      {name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{name}</p>
                      <p className="text-xs text-gray-400">
                        {entries.length} {entries.length === 1 ? 'payment' : 'payments'}
                        {hasUnknown && ' · some amounts unknown'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className={`font-bold text-lg ${tab === 'sent' ? 'text-gray-900' : 'text-accent-600'}`}>
                      ${total.toFixed(2)}
                    </span>
                    <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={open ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
                    </svg>
                  </div>
                </button>

                {open && (
                  <div className="border-t border-gray-100 divide-y divide-gray-50">
                    {entries.map((entry, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-3 gap-4">
                        <div className="min-w-0 flex-1">
                          {entry.linkTo ? (
                            <Link
                              to={entry.linkTo}
                              className="text-sm font-medium text-gray-800 hover:text-accent-600 hover:underline truncate block"
                            >
                              {entry.label}
                            </Link>
                          ) : (
                            <p className="text-sm font-medium text-gray-800 truncate">{entry.label}</p>
                          )}
                          <p className="text-xs text-gray-400 mt-0.5">
                            {entry.sublabel && <span className="mr-1.5">{entry.sublabel} ·</span>}
                            {entry.date ? fmtDate(entry.date) : 'No date'}
                          </p>
                        </div>
                        <div className="shrink-0">
                          {entry.amount != null ? (
                            <span className="text-sm font-semibold text-gray-900">
                              ${entry.amount.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400 italic">unknown</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
