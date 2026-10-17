import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { version as buildVersion } from '../buildVersion.json'
import { useDialog } from '../lib/useDialog.jsx'
import { useGroup, formatWaitingOn } from '../lib/group.jsx'
import { loadReceipts, loadItems, loadClaims, loadPayments, loadMeals, loadCheckins, recordPayment } from '../lib/db.js'
import { receiptDebts, computeBalances } from '../lib/balances.js'
import SettleUpDialog from '../components/SettleUpDialog.jsx'

function effectiveMembers(receipt) {
  const members = receipt.members || []
  const payer = receipt.paid_by
  if (!payer) return members
  if (members.some(m => m.toLowerCase() === payer.toLowerCase())) return members
  return [...members, payer]
}

// "3 receipts ▾" under a person's name, so it's clear the row expands
function ReceiptCountToggle({ count, expanded }) {
  return (
    <p className="flex items-center gap-0.5 text-xs text-gray-500 mt-0.5">
      {expanded ? 'Hide receipts' : `${count} receipt${count === 1 ? '' : 's'}`}
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d={expanded ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
      </svg>
    </p>
  )
}

const fmtShort = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''

// One person's balance with you: name, total, and (expanded) the receipts
// still unpaid. Open amounts always add up to the total.
function PersonBalance({ entry, expanded, onToggle, onSettle, onMarkReceipt, busy }) {
  const count = entry.open.length + (entry.fromPayments > 0 ? 1 : 0)
  return (
    <li className="border border-gray-100 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 transition cursor-pointer" onClick={onToggle}>
        <div className="min-w-0">
          <p className="font-medium text-gray-900">{entry.person}</p>
          <ReceiptCountToggle count={count} expanded={expanded} />
        </div>
        <div className="flex items-center gap-2.5">
          <span className={`font-semibold ${entry.iOwe ? 'text-amber-600' : 'text-gray-900'}`}>${entry.amount.toFixed(2)}</span>
          <button
            onClick={e => { e.stopPropagation(); onSettle() }}
            disabled={busy}
            className={`text-xs px-2 py-0.5 rounded-md transition disabled:opacity-50 font-medium ${entry.iOwe
              ? 'bg-accent-600 text-white hover:bg-accent-700'
              : 'border border-accent-200 text-accent-600 hover:bg-accent-50'}`}
          >
            {entry.iOwe ? 'Mark sent' : 'Mark received'}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-gray-100 px-3 py-2 space-y-1.5">
          {entry.open.map(o => (
            <div key={o.receiptId} className="flex items-center justify-between text-sm gap-2">
              <div className="min-w-0">
                <Link to={`/receipt/${o.receiptId}`} className="text-gray-700 hover:underline">{o.label}</Link>
                <span className="text-gray-400 text-xs ml-1.5">{fmtShort(o.date)}</span>
                {o.remaining < o.cents && <span className="text-gray-400 text-xs ml-1.5">(${(o.cents / 100).toFixed(2)} total, partly paid)</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-gray-900">${(o.remaining / 100).toFixed(2)}</span>
                {entry.iOwe && (
                  <button onClick={() => onMarkReceipt(o)} disabled={busy} className="text-xs px-2 py-0.5 border border-accent-200 text-accent-600 rounded-md hover:bg-accent-50 transition disabled:opacity-50">Mark sent</button>
                )}
              </div>
            </div>
          ))}
          {entry.fromPayments > 0 && (
            <div className="flex items-center justify-between text-sm gap-2">
              <span className="text-gray-700">Overpaid earlier <span className="text-gray-400 text-xs">(from payments, not a receipt)</span></span>
              <span className="text-gray-900 shrink-0">${entry.fromPayments.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

export default function Home() {
  const [standaloneReceipts, setStandaloneReceipts] = useState([])
  const [claimersByReceipt, setClaimersByReceipt] = useState({})
  const [balances, setBalances] = useState(null)
  const [rawData, setRawData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [settle, setSettle] = useState(null) // { from, to, amount, title }
  const [pickerDay, setPickerDay] = useState(null) // { date, items } for 2+ receipts on a day
  const [receiptTotals, setReceiptTotals] = useState({})
  const [expandedPeople, setExpandedPeople] = useState(new Set())
  const [showAllReceipts, setShowAllReceipts] = useState(localStorage.getItem('default-show-all-trips') === '1')
  const [view, setView] = useState(null)
  const [calMonth, setCalMonth] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const { group, myName, nameOf, idOf, memberIds } = useGroup()
  const navigate = useNavigate()
  const { showAlert, DialogUI } = useDialog()

  useEffect(() => {
    fetchData()
  }, [])
  useEffect(() => { window.getSelection()?.removeAllRanges() }, [view])

  useEffect(() => {
    if (!pickerDay) return
    function onKey(e) { if (e.key === 'Escape') setPickerDay(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pickerDay])

  async function fetchData() {
    const [standalone, allItems, allClaims, payments, allMeals, allCheckins] = await Promise.all([
      loadReceipts(group.id, nameOf, 'id, paid_by_member, tip, tax, fees, receipt_date, member_ids, store_name', { datedOnly: true }),
      loadItems(group.id, 'id, receipt_id, meal_id, price'),
      loadClaims(memberIds, nameOf),
      loadPayments(group.id, nameOf),
      loadMeals(group.id, 'id, receipt_id, fee'),
      loadCheckins(memberIds, nameOf),
    ])

    setStandaloneReceipts(standalone)

    // Who has claimed or checked in on each receipt
    const itemIdToReceiptId = {}
    for (const item of allItems) itemIdToReceiptId[item.id] = item.receipt_id
    const receiptMap = {}
    for (const claim of allClaims) {
      const receiptId = itemIdToReceiptId[claim.item_id]
      if (!receiptId) continue
      if (!receiptMap[receiptId]) receiptMap[receiptId] = new Set()
      receiptMap[receiptId].add(claim.roommate.toLowerCase())
    }
    for (const checkin of allCheckins) {
      if (!receiptMap[checkin.receipt_id]) receiptMap[checkin.receipt_id] = new Set()
      receiptMap[checkin.receipt_id].add(checkin.roommate.toLowerCase())
    }
    setClaimersByReceipt(receiptMap)

    // Total spend per receipt
    const receiptTotalsMap = {}
    for (const receipt of standalone) {
      const rItems = allItems.filter(i => i.receipt_id === receipt.id)
      receiptTotalsMap[receipt.id] =
        rItems.reduce((s, i) => s + Number(i.price || 0), 0) +
        Number(receipt.tip || 0) + Number(receipt.tax || 0) + Number(receipt.fees || 0)
    }
    setReceiptTotals(receiptTotalsMap)

    const debts = receiptDebts({ receipts: standalone, items: allItems, claims: allClaims, meals: allMeals, checkins: allCheckins })
    const b = computeBalances(debts, payments)
    setBalances(b)
    setRawData({ allItems })

    // Smart routing: todo if unchecked receipts or money owed, else calendar
    const nameLc = myName.toLowerCase()
    const hasUnchecked = nameLc && standalone.some(r => {
      const members = effectiveMembers(r).map(m => m.toLowerCase())
      return members.includes(nameLc)
        && allItems.some(i => i.receipt_id === r.id)
        && !(receiptMap[r.id]?.has(nameLc))
    })
    const hasDebts = nameLc && b.forPerson(myName).some(e => e.iOwe)
    const sessionSaved = sessionStorage.getItem('home-view')
    let resolvedView
    if (sessionSaved) {
      resolvedView = sessionSaved
    } else if (hasUnchecked || hasDebts) {
      resolvedView = 'todo'
    } else {
      resolvedView = localStorage.getItem('home-view') || 'calendar'
    }
    sessionStorage.setItem('home-view', resolvedView)
    setView(resolvedView)
    setLoading(false)
  }

  const fmtDate = d => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')

  const myBalances = balances && myName ? balances.forPerson(myName).sort((a, b) => b.amount - a.amount) : []
  const iOweEntries = myBalances.filter(e => e.iOwe)
  const owedToMeEntries = myBalances.filter(e => !e.iOwe)
  const iOweTotal = iOweEntries.reduce((s, e) => s + e.amount, 0)
  const pendingTotal = owedToMeEntries.reduce((s, e) => s + e.amount, 0)

  function toggleExpanded(person) {
    setExpandedPeople(prev => {
      const next = new Set(prev)
      next.has(person) ? next.delete(person) : next.add(person)
      return next
    })
  }

  async function savePayment({ from, to, amount, receiptId = null, note = null }) {
    await recordPayment({ groupId: group.id, fromId: idOf(from), toId: idOf(to), amount, receiptId, note })
    await fetchData()
  }

  // "Mark sent" on one receipt: pay what's left on it
  async function markReceiptPaid(entry, open) {
    setBusy(true)
    try {
      await savePayment({ from: myName, to: entry.person, amount: open.remaining / 100, receiptId: open.receiptId })
    } catch (err) {
      await showAlert(err.message, { title: 'Could not save payment' })
    }
    setBusy(false)
  }

  function openSettle(entry) {
    setSettle(entry.iOwe
      ? { from: myName, to: entry.person, amount: entry.amount, title: `Mark sent to ${entry.person}` }
      : { from: entry.person, to: myName, amount: entry.amount, title: `Mark received from ${entry.person}` })
  }

  const myNameLc = myName.toLowerCase()
  const uncheckedReceipts = myName ? standaloneReceipts.filter(r => {
    const members = effectiveMembers(r).map(m => m.toLowerCase())
    if (!members.includes(myNameLc)) return false
    if (!(rawData?.allItems || []).some(i => i.receipt_id === r.id)) return false
    return !(claimersByReceipt[r.id]?.has(myNameLc))
  }) : []
  const todoBadge = uncheckedReceipts.length + iOweEntries.length

  return (
    <>
    {DialogUI}
    {settle && (
      <SettleUpDialog
        {...settle}
        onClose={() => setSettle(null)}
        onSave={async ({ amount, note }) => { await savePayment({ ...settle, amount, note }); setSettle(null) }}
      />
    )}

    {/* Picker modal — opens when 2+ receipts on a day */}
    {pickerDay && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setPickerDay(null)}>
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
          <h2 className="font-semibold text-gray-900 text-lg mb-0.5">
            {pickerDay.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </h2>
          <p className="text-sm text-gray-400 mb-4">Choose one</p>
          <ul className="space-y-2 mb-4">
            {pickerDay.items.map(item => (
              <li key={item.id}>
                <button
                  onClick={() => { setPickerDay(null); navigate(item.url) }}
                  className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-accent-300 hover:bg-accent-50 transition text-sm font-medium text-gray-800"
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
          <button
            onClick={() => { setPickerDay(null); navigate(`/receipt/new?date=${fmtDate(pickerDay.date)}`) }}
            className="w-full py-2 border border-dashed border-gray-300 text-sm text-gray-500 rounded-xl hover:border-accent-400 hover:text-accent-600 transition"
          >
            + Add another receipt
          </button>
        </div>
      </div>
    )}

    <div className="max-w-5xl mx-auto px-4 pt-4 pb-8">

      {/* View toolbar */}
      {view !== null && (
      <div className="flex items-center justify-between gap-2 mb-4 select-none">
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5 min-w-0">
          {[['todo', 'Todo'], ['calendar', 'Calendar'], ['days', 'Days'], ['receipts', 'Receipts']].map(([v, label]) => (
            <button
              key={v}
              onClick={() => { sessionStorage.setItem('home-view', v); if (v !== 'todo') localStorage.setItem('home-view', v); setView(v) }}
              className={`relative px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors ${
                view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
              {v === 'todo' && todoBadge > 0 && (
                <span className="absolute -top-1 -right-1 z-10 min-w-[16px] h-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                  {todoBadge}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5 shrink-0">
          {[['mine', 'Mine'], ['all', 'All']].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setShowAllReceipts(v === 'all')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                (v === 'all') === showAllReceipts ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      )}

      {/* Todo view */}
      {view === 'todo' && (
        <div className="max-w-2xl mx-auto space-y-4">

          {/* Receipts to check off */}
          {uncheckedReceipts.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-gray-800">Receipts to check off</h2>
                <span className="text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{uncheckedReceipts.length}</span>
              </div>
              <ul className="divide-y divide-gray-100">
                {uncheckedReceipts.map(r => {
                  const date = new Date(r.receipt_date + 'T12:00:00')
                  return (
                    <li key={r.id}>
                      <Link
                        to={`/receipt/${r.id}`}
                        className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-2 h-2 rounded-full shrink-0 bg-amber-400" />
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 truncate">{r.store_name || 'Receipt'}</p>
                            <p className="text-xs text-gray-400">
                              {date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · Paid by {r.paid_by}
                            </p>
                          </div>
                        </div>
                        <span className="text-gray-300 shrink-0 ml-3">›</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* People you owe */}
          {iOweEntries.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-800">People you owe</h2>
                <span className="text-sm font-semibold text-amber-600">${iOweTotal.toFixed(2)}</span>
              </div>
              <ul className="space-y-1.5 select-none">
                {iOweEntries.map(entry => (
                  <PersonBalance
                    key={entry.person}
                    entry={entry}
                    expanded={expandedPeople.has(`owe-${entry.person}`)}
                    onToggle={() => toggleExpanded(`owe-${entry.person}`)}
                    onSettle={() => openSettle(entry)}
                    onMarkReceipt={open => markReceiptPaid(entry, open)}
                    busy={busy}
                  />
                ))}
              </ul>
            </div>
          )}

          {/* People who owe you */}
          {owedToMeEntries.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-800">People who owe you</h2>
                <span className="text-sm font-semibold text-accent-600">${pendingTotal.toFixed(2)}</span>
              </div>
              <ul className="space-y-1.5 select-none">
                {owedToMeEntries.map(entry => (
                  <PersonBalance
                    key={entry.person}
                    entry={entry}
                    expanded={expandedPeople.has(entry.person)}
                    onToggle={() => toggleExpanded(entry.person)}
                    onSettle={() => openSettle(entry)}
                    busy={busy}
                  />
                ))}
              </ul>
            </div>
          )}

          {/* All clear */}
          {uncheckedReceipts.length === 0 && iOweEntries.length === 0 && owedToMeEntries.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-3xl mb-3">🎉</p>
              <p className="font-semibold text-gray-800 text-lg">You're all caught up!</p>
              <p className="text-sm text-gray-400 mt-1">No receipts to check off and no outstanding debts.</p>
              <button
                onClick={() => { sessionStorage.setItem('home-view', 'calendar'); localStorage.setItem('home-view', 'calendar'); setView('calendar') }}
                className="mt-4 text-sm text-accent-600 hover:text-accent-700 font-medium transition"
              >
                View calendar →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Calendar view */}
      {view === 'calendar' && (() => {
        const now = new Date()
        const isCurrentMonth = calMonth.year === now.getFullYear() && calMonth.month === now.getMonth()
        const firstDay = new Date(calMonth.year, calMonth.month, 1)
        const daysInMonth = new Date(calMonth.year, calMonth.month + 1, 0).getDate()
        const startPad = firstDay.getDay()
        const totalCells = Math.ceil((startPad + daysInMonth) / 7) * 7

        // Build grid including overflow days from adjacent months
        const calDays = Array.from({ length: totalCells }, (_, i) => {
          const dayNum = i - startPad + 1
          const date = new Date(calMonth.year, calMonth.month, dayNum)
          return { date, isCurrent: dayNum >= 1 && dayNum <= daysInMonth }
        })

        // Group receipts by receipt_date
        const receiptsByDate = {}
        for (const receipt of standaloneReceipts) {
          const d = new Date(receipt.receipt_date + 'T12:00:00')
          const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
          if (!receiptsByDate[key]) receiptsByDate[key] = []
          receiptsByDate[key].push(receipt)
        }

        return (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <button
                onClick={() => setCalMonth(prev => { const d = new Date(prev.year, prev.month - 1, 1); return { year: d.getFullYear(), month: d.getMonth() } })}
                className="p-2 hover:bg-gray-100 rounded-lg transition text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-gray-800">
                  {firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </h2>
                {!isCurrentMonth && (
                  <button
                    onClick={() => setCalMonth({ year: now.getFullYear(), month: now.getMonth() })}
                    className="text-xs text-accent-600 hover:text-accent-700 font-medium border border-accent-300 hover:border-accent-400 px-2 py-0.5 rounded-md transition"
                  >
                    ↩ Jump to today
                  </button>
                )}
              </div>
              <button
                onClick={() => setCalMonth(prev => { const d = new Date(prev.year, prev.month + 1, 1); return { year: d.getFullYear(), month: d.getMonth() } })}
                className="p-2 hover:bg-gray-100 rounded-lg transition text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {/* Day-of-week headers */}
            <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50/50">
              {['SUN','MON','TUE','WED','THU','FRI','SAT'].map(d => (
                <div key={d} className="text-center text-xs font-semibold text-gray-400 tracking-widest py-3">{d}</div>
              ))}
            </div>

            {/* Grid */}
            {loading ? (
              <div className="min-h-[560px] flex items-center justify-center text-gray-300 text-sm">Loading…</div>
            ) : (
              <div className="grid grid-cols-7 divide-x divide-y divide-gray-100">
                {calDays.map(({ date, isCurrent }, i) => {
                  const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
                  const isToday = date.toDateString() === now.toDateString()
                  const dayReceipts = (receiptsByDate[key] || []).filter(r =>
                    showAllReceipts || !myName || effectiveMembers(r).length === 0 || effectiveMembers(r).some(m => m.toLowerCase() === myName.toLowerCase())
                  )
                  const dayTotal = dayReceipts.reduce((s, r) => s + (receiptTotals[r.id] || 0), 0)
                  const dayItems = dayReceipts.map(r => ({ id: r.id, label: r.store_name, url: `/receipt/${r.id}` }))

                  function handleCellClick() {
                    if (dayItems.length === 0) {
                      navigate(`/receipt/new?date=${fmtDate(date)}`)
                    } else if (dayItems.length === 1) {
                      navigate(dayItems[0].url)
                    } else {
                      setPickerDay({ date, items: dayItems })
                    }
                  }

                  return (
                    <div
                      key={`${key}-${i}`}
                      onClick={handleCellClick}
                      className={`relative min-h-28 p-2.5 transition-colors group cursor-pointer hover:bg-gray-50/80 select-none ${
                        !isCurrent ? 'bg-gray-50/60' : ''
                      } ${isToday ? 'ring-2 ring-inset ring-accent-600' : ''}`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className={`text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full leading-none ${
                          isToday ? 'bg-accent-600 text-white' : isCurrent ? 'text-gray-700' : 'text-gray-300'
                        }`}>
                          {date.getDate()}
                        </div>
                        {dayTotal > 0 && isCurrent && (
                          <span className="text-xs font-semibold text-accent-600">${dayTotal.toFixed(2)}</span>
                        )}
                      </div>
                      <div className="space-y-1">
                        {dayReceipts.map(receipt => {
                          const claimers = claimersByReceipt[receipt.id] || new Set()
                          const waitingOn = claimers.size > 0
                            ? effectiveMembers(receipt).filter(m => !claimers.has(m.toLowerCase()))
                            : []
                          return (
                            <div key={receipt.id} className="flex items-center gap-1.5 text-xs text-gray-600">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                waitingOn.length > 0 ? 'bg-amber-400' : 'bg-accent-500'
                              }`} />
                              <span className="truncate">{receipt.store_name}</span>
                            </div>
                          )
                        })}
                      </div>
                      {/* Hover "+" button — bottom right */}
                      {isCurrent && dayItems.length >= 1 && (
                        <button
                          onClick={e => { e.stopPropagation(); navigate(`/receipt/new?date=${fmtDate(date)}`) }}
                          className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 flex items-center justify-center rounded-full bg-accent-100 text-accent-600 hover:bg-accent-200 text-xs font-bold leading-none pb-px"
                          title="Add another receipt"
                        >
                          +
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}

      {/* Days view */}
      {view === 'days' && (() => {
        const filtered = standaloneReceipts.filter(r =>
          showAllReceipts || !myName || effectiveMembers(r).length === 0 || effectiveMembers(r).some(m => m.toLowerCase() === myName.toLowerCase())
        )
        const byDate = {}
        for (const r of filtered) {
          const key = r.receipt_date
          if (!byDate[key]) byDate[key] = []
          byDate[key].push(r)
        }
        const sortedDays = Object.keys(byDate).sort((a, b) => b.localeCompare(a))
        if (sortedDays.length === 0) return (
          <div className="text-center py-16 text-gray-400 text-sm">No receipts yet.</div>
        )
        return (
          <div className="space-y-6">
            {sortedDays.map(dateKey => {
              const date = new Date(dateKey + 'T12:00:00')
              const dayLabel = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
              const receipts = byDate[dateKey]
              const dayTotal = receipts.reduce((s, r) => s + (receiptTotals[r.id] || 0), 0)
              return (
                <div key={dateKey}>
                  <div className="flex items-baseline justify-between mb-2">
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{dayLabel}</h3>
                    {dayTotal > 0 && <span className="text-sm font-semibold text-accent-600">${dayTotal.toFixed(2)}</span>}
                  </div>
                  <div className="space-y-2">
                    {receipts.map(r => {
                      const claimers = claimersByReceipt[r.id] || new Set()
                      const waitingOn = claimers.size > 0 && effectiveMembers(r).length
                        ? effectiveMembers(r).filter(m => !claimers.has(m.toLowerCase()))
                        : []
                      const total = receiptTotals[r.id] || 0
                      return (
                        <button
                          key={r.id}
                          onClick={() => navigate(`/receipt/${r.id}`)}
                          className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-accent-300 hover:shadow-sm transition text-left select-none"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${waitingOn.length > 0 ? 'bg-amber-400' : 'bg-accent-500'}`} />
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 truncate">{r.store_name || 'Receipt'}</p>
                              {waitingOn.length > 0 && (
                                <p className="text-xs text-amber-600">Waiting on {formatWaitingOn(waitingOn, myName)}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 ml-3">
                            {total > 0 && <span className="text-sm font-semibold text-gray-700">${total.toFixed(2)}</span>}
                            <span className="text-gray-300">›</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })()}

      {/* Receipts view */}
      {view === 'receipts' && (() => {
        const filtered = [...standaloneReceipts]
          .filter(r =>
            showAllReceipts || !myName || effectiveMembers(r).length === 0 || effectiveMembers(r).some(m => m.toLowerCase() === myName.toLowerCase())
          )
          .sort((a, b) => b.receipt_date.localeCompare(a.receipt_date))
        if (filtered.length === 0) return (
          <div className="text-center py-16 text-gray-400 text-sm">No receipts yet.</div>
        )
        return (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm divide-y divide-gray-100 select-none">
            {filtered.map(r => {
              const claimers = claimersByReceipt[r.id] || new Set()
              const waitingOn = claimers.size > 0 && effectiveMembers(r).length
                ? effectiveMembers(r).filter(m => !claimers.has(m.toLowerCase()))
                : []
              const total = receiptTotals[r.id] || 0
              const date = new Date(r.receipt_date + 'T12:00:00')
              return (
                <button
                  key={r.id}
                  onClick={() => navigate(`/receipt/${r.id}`)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${waitingOn.length > 0 ? 'bg-amber-400' : 'bg-accent-500'}`} />
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{r.store_name || 'Receipt'}</p>
                      <p className="text-xs text-gray-400">
                        {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {waitingOn.length > 0 && <span className="text-amber-600 ml-2">· Waiting on {formatWaitingOn(waitingOn, myName)}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    {total > 0 && <span className="text-sm font-semibold text-gray-700">${total.toFixed(2)}</span>}
                    <span className="text-gray-300">›</span>
                  </div>
                </button>
              )
            })}
          </div>
        )
      })()}

      <p className="mt-8 text-center text-xs text-gray-300">v{buildVersion}</p>
    </div>
    </>
  )
}
