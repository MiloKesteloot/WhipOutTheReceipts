import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { calculateDebts } from '../lib/splitLogic.js'
import { version as buildVersion } from '../buildVersion.json'
import { useDialog } from '../lib/useDialog.jsx'

export default function Home() {
  const [standaloneReceipts, setStandaloneReceipts] = useState([])
  const [claimersByReceipt, setClaimersByReceipt] = useState({})
  // person -> { net, theyOweMe: [...], iOweThem: [...] }
  const [netByPerson, setNetByPerson] = useState({})
  const [rawData, setRawData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [settling, setSettling] = useState(null)
  const [pickerDay, setPickerDay] = useState(null) // { date, items } for 2+ receipts on a day
  const [receiptTotals, setReceiptTotals] = useState({})
  const [expandedPeople, setExpandedPeople] = useState(new Set())
  const [showAllReceipts, setShowAllReceipts] = useState(localStorage.getItem('default-show-all-trips') === '1')
  const [view, setView] = useState(null)
  const [calMonth, setCalMonth] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const myName = localStorage.getItem('global-name') || ''
  const navigate = useNavigate()
  const { DialogUI } = useDialog()

  useEffect(() => {
    fetchTrips()
  }, [])
  useEffect(() => { if (rawData) computeDebts(myName, rawData) }, [rawData])

  useEffect(() => {
    if (!pickerDay) return
    function onKey(e) { if (e.key === 'Escape') setPickerDay(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pickerDay])

  async function fetchTrips() {
    const [receiptsRes, itemsRes, claimsRes, settlementsRes, mealsRes, checkinsRes] = await Promise.all([
      supabase.from('receipts').select('id, paid_by, tip, tax, fees, receipt_date, members, store_name').not('receipt_date', 'is', null),
      supabase.from('items').select('id, receipt_id, meal_id, price'),
      supabase.from('claims').select('item_id, roommate'),
      supabase.from('settlements').select('receipt_id, debtor, creditor'),
      supabase.from('meals').select('id, receipt_id, fee'),
      supabase.from('checkins').select('receipt_id, roommate'),
    ])

    const standalone = receiptsRes.data || []
    const allItems = itemsRes.data || []
    const allClaims = claimsRes.data || []
    const settlements = settlementsRes.data || []
    const allMeals = mealsRes.data || []
    const allCheckins = checkinsRes.data || []

    setStandaloneReceipts(standalone)

    // Build claimersByReceipt
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
      if (!checkin.receipt_id) continue
      if (!receiptMap[checkin.receipt_id]) receiptMap[checkin.receipt_id] = new Set()
      receiptMap[checkin.receipt_id].add(checkin.roommate.toLowerCase())
    }
    setClaimersByReceipt(receiptMap)

    // Compute total spend per receipt
    const receiptTotalsMap = {}
    for (const receipt of standalone) {
      const rItems = allItems.filter(i => i.receipt_id === receipt.id)
      receiptTotalsMap[receipt.id] =
        rItems.reduce((s, i) => s + Number(i.price || 0), 0) +
        Number(receipt.tip || 0) + Number(receipt.tax || 0) + Number(receipt.fees || 0)
    }
    setReceiptTotals(receiptTotalsMap)

    const data = { allItems, allClaims, settlements, allMeals, standalone, allCheckins }
    setRawData(data)
    const nameLc = (localStorage.getItem('global-name') || '').toLowerCase()
    const byPerson = computeDebts(localStorage.getItem('global-name') || '', data)
    // Smart routing: todo if unchecked receipts or unsettled debts, else calendar
    const hasUnchecked = nameLc && standalone.some(r => {
      const members = (r.members || []).map(m => m.toLowerCase())
      return members.includes(nameLc)
        && allItems.some(i => i.receipt_id === r.id)
        && !(receiptMap[r.id]?.has(nameLc))
    })
    const hasDebts = nameLc && Object.values(byPerson || {}).some(d => {
      const owe = d.iOweThem.filter(e => !e.settled).reduce((s, e) => s + e.amount, 0)
             - d.theyOweMe.filter(e => !e.settled).reduce((s, e) => s + e.amount, 0)
      return owe > 0.005
    })
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

  function computeDebts(name, { allItems, allClaims, settlements, allMeals = [], standalone = [], allCheckins = [] }) {
    if (!name) { setNetByPerson({}); return }

    const nameLc = name.toLowerCase()
    const byPerson = {}

    // Build checkin set per receipt
    const checkinsByReceipt = {}
    for (const c of allCheckins) {
      if (!c.receipt_id) continue
      if (!checkinsByReceipt[c.receipt_id]) checkinsByReceipt[c.receipt_id] = new Set()
      checkinsByReceipt[c.receipt_id].add(c.roommate.toLowerCase())
    }

    // Receipt debts
    for (const receipt of standalone) {
      const rItems = allItems.filter(i => i.receipt_id === receipt.id)
      if (!rItems.length) continue

      // Skip until everyone on the receipt has checked in
      const members = (receipt.members || []).map(m => m.toLowerCase())
      if (members.length > 0) {
        const checkedIn = checkinsByReceipt[receipt.id] || new Set()
        if (!members.every(m => checkedIn.has(m))) continue
      }
      const itemIds = new Set(rItems.map(i => i.id))
      const rClaims = allClaims.filter(c => itemIds.has(c.item_id))
      const rMeals = allMeals.filter(m => m.receipt_id === receipt.id)

      for (const debt of calculateDebts([receipt], rItems, rClaims, rMeals)) {
        const settled = settlements.some(
          s => s.receipt_id === receipt.id
            && s.debtor.toLowerCase() === debt.debtor.toLowerCase()
            && s.creditor.toLowerCase() === debt.creditor.toLowerCase()
        )
        const label = receipt.store_name || 'Receipt'
        if (debt.creditor.toLowerCase() === nameLc) {
          const person = debt.debtor.toLowerCase()
          if (!byPerson[person]) byPerson[person] = { net: 0, theyOweMe: [], iOweThem: [] }
          byPerson[person].theyOweMe.push({ ...debt, label, receiptId: receipt.id, settled })
          byPerson[person].net += debt.amount
        }
        if (debt.debtor.toLowerCase() === nameLc) {
          const person = debt.creditor.toLowerCase()
          if (!byPerson[person]) byPerson[person] = { net: 0, theyOweMe: [], iOweThem: [] }
          byPerson[person].iOweThem.push({ ...debt, label, receiptId: receipt.id, settled })
          byPerson[person].net -= debt.amount
        }
      }
    }

    setNetByPerson(byPerson)
    return byPerson
  }

  const toTitleCase = s => s.replace(/\b\w/g, c => c.toUpperCase())
  const fmtDate = d => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')

  // Unsettled net amounts — used for filtering and display
  function unsettledOwedToMe(data) {
    return data.theyOweMe.filter(e => !e.settled).reduce((s, e) => s + e.amount, 0)
         - data.iOweThem.filter(e => !e.settled).reduce((s, e) => s + e.amount, 0)
  }
  function unsettledIOwe(data) {
    return data.iOweThem.filter(e => !e.settled).reduce((s, e) => s + e.amount, 0)
         - data.theyOweMe.filter(e => !e.settled).reduce((s, e) => s + e.amount, 0)
  }

  const owedToMeEntries = Object.entries(netByPerson).filter(([, d]) => unsettledOwedToMe(d) > 0.005)
  const iOweEntries = Object.entries(netByPerson).filter(([, d]) => unsettledIOwe(d) > 0.005)

  const pendingTotal = owedToMeEntries.reduce((s, [, d]) => s + unsettledOwedToMe(d), 0)

function toggleExpanded(person) {
    setExpandedPeople(prev => {
      const next = new Set(prev)
      next.has(person) ? next.delete(person) : next.add(person)
      return next
    })
  }

    async function markSettled(entry) {
    setSettling({ entry })
    await supabase.from('settlements').delete()
      .eq('receipt_id', entry.receiptId).eq('debtor', myName).eq('creditor', entry.creditor)
    await supabase.from('settlements').insert({ receipt_id: entry.receiptId, debtor: myName, creditor: entry.creditor })
    await fetchTrips()
    setSettling(null)
  }

  async function markAllSettledWith(person, data) {
    setSettling({ person })
    const entries = [
      ...data.iOweThem.map(e => ({ receipt_id: e.receiptId, debtor: myName, creditor: person })),
      ...data.theyOweMe.map(e => ({ receipt_id: e.receiptId, debtor: person, creditor: myName })),
    ]
    for (const s of entries) {
      await supabase.from('settlements').delete()
        .eq('receipt_id', s.receipt_id).eq('debtor', s.debtor).eq('creditor', s.creditor)
      await supabase.from('settlements').insert(s)
    }
    await fetchTrips()
    setSettling(null)
  }

  const iOweTotal = iOweEntries.reduce((s, [, d]) => s + unsettledIOwe(d), 0)

  const myNameLc = myName.toLowerCase()
  const uncheckedReceipts = myName ? standaloneReceipts.filter(r => {
    const members = (r.members || []).map(m => m.toLowerCase())
    if (!members.includes(myNameLc)) return false
    if (!(rawData?.allItems || []).some(i => i.receipt_id === r.id)) return false
    return !(claimersByReceipt[r.id]?.has(myNameLc))
  }) : []
  const todoBadge = uncheckedReceipts.length + iOweEntries.length

  return (
    <>
    {DialogUI}

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
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5">
          {[['todo', 'Todo'], ['calendar', 'Calendar'], ['days', 'Days'], ['receipts', 'Receipts']].map(([v, label]) => (
            <button
              key={v}
              onClick={() => { sessionStorage.setItem('home-view', v); if (v !== 'todo') localStorage.setItem('home-view', v); setView(v) }}
              className={`relative px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
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
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5">
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
          {myName && iOweEntries.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-800">People you owe</h2>
                <span className="text-sm font-semibold text-amber-600">${iOweTotal.toFixed(2)}</span>
              </div>
              <ul className="space-y-1.5">
                {iOweEntries.map(([person, data]) => {
                  const netOwed = unsettledIOwe(data)
                  const expanded = expandedPeople.has(`owe-${person}`)
                  const hasOffset = data.theyOweMe.some(e => !e.settled)
                  return (
                    <li key={person} className="border border-gray-100 rounded-lg overflow-hidden">
                      <div
                        className="flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 transition cursor-pointer"
                        onClick={() => toggleExpanded(`owe-${person}`)}
                      >
                        <span className="font-medium text-gray-900">{toTitleCase(person)}</span>
                        <div className="flex items-center gap-2.5">
                          {hasOffset && <span className="text-xs text-gray-400">net</span>}
                          <span className="font-semibold text-amber-600">${netOwed.toFixed(2)}</span>
                          {data.iOweThem.some(e => !e.settled) && (
                            <button
                              onClick={e => { e.stopPropagation(); markAllSettledWith(person, data) }}
                              disabled={!!settling}
                              className="text-xs px-2 py-0.5 bg-accent-600 text-white rounded-md hover:bg-accent-700 transition disabled:opacity-50 font-medium"
                            >
                              {settling?.person === person ? '…' : 'Mark sent'}
                            </button>
                          )}
                          <svg className="w-3.5 h-3.5 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d={expanded ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
                          </svg>
                        </div>
                      </div>
                      {expanded && (
                        <div className="border-t border-gray-100 px-3 py-2 space-y-1.5">
                          {data.iOweThem.every(e => e.settled) && data.theyOweMe.every(e => e.settled) && (
                            <p className="text-xs text-accent-600 font-medium py-1">All settled ✓</p>
                          )}
                          {data.iOweThem.map((entry, i) => (
                            <div key={i} className="flex items-center justify-between text-sm gap-2">
                              <div className="min-w-0">
                                <Link to={`/receipt/${entry.receiptId}`} className="text-gray-700 hover:underline" onClick={e => e.stopPropagation()}>{entry.label}</Link>
                                <span className="text-gray-400 text-xs ml-1.5">you owe</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-gray-900">${entry.amount.toFixed(2)}</span>
                                {entry.settled ? (
                                  <span className="text-xs text-accent-600 font-medium">✓ sent</span>
                                ) : (
                                  <button onClick={() => markSettled({ ...entry, creditor: person })} disabled={!!settling} className="text-xs px-2 py-0.5 border border-accent-200 text-accent-600 rounded-md hover:bg-accent-50 transition disabled:opacity-50">Mark sent</button>
                                )}
                              </div>
                            </div>
                          ))}
                          {data.theyOweMe.map((entry, i) => (
                            <div key={i} className="flex items-center justify-between text-sm gap-2">
                              <div className="min-w-0">
                                <Link to={`/receipt/${entry.receiptId}`} className="text-gray-700 hover:underline" onClick={e => e.stopPropagation()}>{entry.label}</Link>
                                <span className="text-gray-400 text-xs ml-1.5">offset</span>
                              </div>
                              <span className="text-gray-400 shrink-0">−${entry.amount.toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* People who owe you */}
          {myName && owedToMeEntries.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-800">People who owe you</h2>
                <span className="text-sm font-semibold text-accent-600">${pendingTotal.toFixed(2)}</span>
              </div>
              <ul className="space-y-1.5">
                {owedToMeEntries.map(([person, data]) => {
                  const expanded = expandedPeople.has(person)
                  const netAmt = unsettledOwedToMe(data)
                  const hasOffset = data.iOweThem.some(e => !e.settled)
                  return (
                    <li key={person} className="border border-gray-100 rounded-lg overflow-hidden">
                      <button onClick={() => toggleExpanded(person)} className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 transition text-left">
                        <span className="font-medium text-gray-900">{toTitleCase(person)}</span>
                        <div className="flex items-center gap-2.5">
                          {hasOffset && <span className="text-xs text-gray-400">net</span>}
                          <span className="font-semibold text-gray-900">${netAmt.toFixed(2)}</span>
                          <svg className="w-3.5 h-3.5 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d={expanded ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
                          </svg>
                        </div>
                      </button>
                      {expanded && (
                        <div className="border-t border-gray-100 px-3 py-2 space-y-1.5">
                          {data.theyOweMe.map((entry, i) => (
                            <div key={i} className="flex items-center justify-between text-sm gap-2">
                              <div className="min-w-0">
                                <Link to={`/receipt/${entry.receiptId}`} className="text-gray-700 hover:underline" onClick={e => e.stopPropagation()}>{entry.label}</Link>
                                <span className="text-gray-400 text-xs ml-1.5">owes you</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-gray-900">${entry.amount.toFixed(2)}</span>
                                {entry.settled ? <span className="text-xs text-accent-600 font-medium">✓ sent</span> : <span className="text-xs text-amber-500">awaiting</span>}
                              </div>
                            </div>
                          ))}
                          {data.iOweThem.map((entry, i) => (
                            <div key={i} className="flex items-center justify-between text-sm gap-2">
                              <div className="min-w-0">
                                <Link to={`/receipt/${entry.receiptId}`} className="text-gray-700 hover:underline" onClick={e => e.stopPropagation()}>{entry.label}</Link>
                                <span className="text-gray-400 text-xs ml-1.5">offset</span>
                              </div>
                              <span className="text-gray-400 shrink-0">−${entry.amount.toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </li>
                  )
                })}
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
                    showAllReceipts || !myName || !(r.members?.length) || r.members.some(m => m.toLowerCase() === myName.toLowerCase())
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
                      className={`relative min-h-28 p-2.5 transition-colors group cursor-pointer hover:bg-gray-50/80 ${
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
                            ? (receipt.members || []).filter(m => !claimers.has(m.toLowerCase()))
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
          showAllReceipts || !myName || !(r.members?.length) || r.members.some(m => m.toLowerCase() === myName.toLowerCase())
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
                      const waitingOn = claimers.size > 0 && r.members?.length
                        ? r.members.filter(m => !claimers.has(m.toLowerCase()))
                        : []
                      const total = receiptTotals[r.id] || 0
                      return (
                        <button
                          key={r.id}
                          onClick={() => navigate(`/receipt/${r.id}`)}
                          className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-accent-300 hover:shadow-sm transition text-left"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${waitingOn.length > 0 ? 'bg-amber-400' : 'bg-accent-500'}`} />
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 truncate">{r.store_name || 'Receipt'}</p>
                              {waitingOn.length > 0 && (
                                <p className="text-xs text-amber-600">Waiting on {waitingOn.join(', ')}</p>
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
            showAllReceipts || !myName || !(r.members?.length) || r.members.some(m => m.toLowerCase() === myName.toLowerCase())
          )
          .sort((a, b) => b.receipt_date.localeCompare(a.receipt_date))
        if (filtered.length === 0) return (
          <div className="text-center py-16 text-gray-400 text-sm">No receipts yet.</div>
        )
        return (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm divide-y divide-gray-100">
            {filtered.map(r => {
              const claimers = claimersByReceipt[r.id] || new Set()
              const waitingOn = claimers.size > 0 && r.members?.length
                ? r.members.filter(m => !claimers.has(m.toLowerCase()))
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
                        {waitingOn.length > 0 && <span className="text-amber-600 ml-2">· Waiting on {waitingOn.join(', ')}</span>}
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
