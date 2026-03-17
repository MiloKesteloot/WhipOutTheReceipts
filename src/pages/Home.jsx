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
  const [view, setView] = useState(() => localStorage.getItem('home-view') || 'calendar')
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

    const data = { allItems, allClaims, settlements, allMeals, standalone }
    setRawData(data)
    computeDebts(localStorage.getItem('global-name') || '', data)
    setLoading(false)
  }

  function computeDebts(name, { allItems, allClaims, settlements, allMeals = [], standalone = [] }) {
    if (!name) { setNetByPerson({}); return }

    const nameLc = name.toLowerCase()
    const byPerson = {}

    // Receipt debts
    for (const receipt of standalone) {
      const rItems = allItems.filter(i => i.receipt_id === receipt.id)
      if (!rItems.length) continue
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

    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-1">Receipts</h1>
        <p className="text-gray-500">Fair grocery splits for roommates.</p>
      </div>

      {/* Debt summaries — narrower for readability */}
      <div className="max-w-2xl space-y-4 mb-8">

      {/* People who owe you — grouped by person, collapsible, net amounts */}
      {myName && owedToMeEntries.length > 0 && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-4">
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
                  <button
                    onClick={() => toggleExpanded(person)}
                    className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 transition text-left"
                  >
                    <span className="font-medium text-gray-900">{toTitleCase(person)}</span>
                    <div className="flex items-center gap-2.5">
                      {hasOffset && (
                        <span className="text-xs text-gray-400">net</span>
                      )}
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
                            <Link
                              to={`/receipt/${entry.receiptId}`}
                              className="text-gray-700 hover:underline"
                              onClick={e => e.stopPropagation()}
                            >
                              {entry.label}
                            </Link>
                            <span className="text-gray-400 text-xs ml-1.5">owes you</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-gray-900">${entry.amount.toFixed(2)}</span>
                            {entry.settled
                              ? <span className="text-xs text-accent-600 font-medium">✓ sent</span>
                              : <span className="text-xs text-amber-500">awaiting</span>
                            }
                          </div>
                        </div>
                      ))}
                      {data.iOweThem.map((entry, i) => (
                        <div key={i} className="flex items-center justify-between text-sm gap-2">
                          <div className="min-w-0">
                            <Link
                              to={`/receipt/${entry.receiptId}`}
                              className="text-gray-700 hover:underline"
                              onClick={e => e.stopPropagation()}
                            >
                              {entry.label}
                            </Link>
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

      {/* People you owe — grouped by person, collapsible, net amounts */}
      {myName && iOweEntries.length > 0 && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-4">
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
                  <button
                    onClick={() => toggleExpanded(`owe-${person}`)}
                    className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 transition text-left"
                  >
                    <span className="font-medium text-gray-900">{toTitleCase(person)}</span>
                    <div className="flex items-center gap-2.5">
                      {hasOffset && (
                        <span className="text-xs text-gray-400">net</span>
                      )}
                      <span className="font-semibold text-amber-600">${netOwed.toFixed(2)}</span>
                      <svg className="w-3.5 h-3.5 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={expanded ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
                    </svg>
                    </div>
                  </button>
                  {expanded && (
                    <div className="border-t border-gray-100 px-3 py-2 space-y-1.5">
                      {data.iOweThem.every(e => e.settled) && data.theyOweMe.every(e => e.settled) ? (
                        <p className="text-xs text-accent-600 font-medium py-1">All settled ✓</p>
                      ) : (
                        <button
                          onClick={() => markAllSettledWith(person, data)}
                          disabled={!!settling}
                          className="w-full text-sm py-1.5 px-3 bg-accent-600 text-white rounded-lg hover:bg-accent-700 transition disabled:opacity-50 font-medium"
                        >
                          {settling?.person === person ? '…' : `Mark everything settled with ${toTitleCase(person)}`}
                        </button>
                      )}
                      {data.iOweThem.map((entry, i) => (
                          <div key={i} className="flex items-center justify-between text-sm gap-2">
                            <div className="min-w-0">
                              <Link
                                to={`/receipt/${entry.receiptId}`}
                                className="text-gray-700 hover:underline"
                                onClick={e => e.stopPropagation()}
                              >
                                {entry.label}
                              </Link>
                              <span className="text-gray-400 text-xs ml-1.5">you owe</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-gray-900">${entry.amount.toFixed(2)}</span>
                              {entry.settled ? (
                                <span className="text-xs text-accent-600 font-medium">✓ sent</span>
                              ) : (
                                <button
                                  onClick={() => markSettled({ ...entry, creditor: person })}
                                  disabled={!!settling}
                                  className="text-xs px-2 py-0.5 border border-accent-200 text-accent-600 rounded-md hover:bg-accent-50 transition disabled:opacity-50"
                                >
                                  Mark sent
                                </button>
                              )}
                            </div>
                          </div>
                      ))}
                      {data.theyOweMe.map((entry, i) => (
                        <div key={i} className="flex items-center justify-between text-sm gap-2">
                          <div className="min-w-0">
                            <Link
                              to={`/receipt/${entry.receiptId}`}
                              className="text-gray-700 hover:underline"
                              onClick={e => e.stopPropagation()}
                            >
                              {entry.label}
                            </Link>
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

      </div>{/* end debt summaries */}

      {/* View toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5">
          {[['calendar', 'Calendar'], ['days', 'Days'], ['receipts', 'Receipts']].map(([v, label]) => (
            <button
              key={v}
              onClick={() => { setView(v); localStorage.setItem('home-view', v) }}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowAllReceipts(s => !s)}
          className="text-xs text-gray-400 hover:text-gray-600 transition px-2 py-1 rounded hover:bg-gray-100"
        >
          {showAllReceipts ? 'All' : 'Mine'}
        </button>
      </div>

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
                    className="text-xs text-accent-600 hover:text-accent-700 font-medium transition"
                  >
                    Today
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
              <p className="text-gray-400 text-sm p-6">Loading…</p>
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
                    if (!isCurrent) return
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
                      className={`relative min-h-28 p-2.5 transition-colors group ${
                        !isCurrent ? 'bg-gray-50/60 cursor-default' : 'hover:bg-gray-50/80 cursor-pointer'
                      } ${isToday ? 'ring-2 ring-inset ring-accent-500' : ''}`}
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
