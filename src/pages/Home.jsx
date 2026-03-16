import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { calculateDebts } from '../lib/splitLogic.js'
import { version as buildVersion } from '../buildVersion.json'
import { fetchCoreRoommates } from './Settings.jsx'
import { useDialog } from '../lib/useDialog.jsx'

export default function Home() {
  const [trips, setTrips] = useState([])
  const [claimersByTrip, setClaimersByTrip] = useState({})
  // person -> { net, theyOweMe: [...], iOweThem: [...] }
  const [netByPerson, setNetByPerson] = useState({})
  const [rawData, setRawData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [settling, setSettling] = useState(null)
  const [tripName, setTripName] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [coreRoommates, setCoreRoommates] = useState([])
  const [members, setMembers] = useState([])
  const [newMemberInput, setNewMemberInput] = useState('')
  const [expandedPeople, setExpandedPeople] = useState(new Set())
  const [showAllTrips, setShowAllTrips] = useState(localStorage.getItem('default-show-all-trips') === '1')
  const [calMonth, setCalMonth] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const myName = localStorage.getItem('global-name') || ''
  const navigate = useNavigate()
  const { showAlert, DialogUI } = useDialog()

  const today = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })

  useEffect(() => {
    fetchTrips()
    fetchCoreRoommates().then(core => { setCoreRoommates(core); setMembers(core) })
  }, [])
  useEffect(() => { if (rawData) computeDebts(myName, rawData) }, [rawData])

  async function fetchTrips() {
    const [tripsRes, receiptsRes, itemsRes, claimsRes, settlementsRes, mealsRes, checkinsRes] = await Promise.all([
      supabase.from('trips').select('*').order('created_at', { ascending: false }),
      supabase.from('receipts').select('id, trip_id, paid_by, tip, tax, fees'),
      supabase.from('items').select('id, receipt_id, meal_id, price'),
      supabase.from('claims').select('item_id, roommate'),
      supabase.from('settlements').select('trip_id, debtor, creditor'),
      supabase.from('meals').select('id, receipt_id, fee'),
      supabase.from('checkins').select('trip_id, roommate'),
    ])

    const trips = tripsRes.data || []
    const allReceipts = receiptsRes.data || []
    const allItems = itemsRes.data || []
    const allClaims = claimsRes.data || []
    const settlements = settlementsRes.data || []
    const allMeals = mealsRes.data || []
    const allCheckins = checkinsRes.data || []

    setTrips(trips)

    // Build claimersByTrip — includes anyone who claimed items OR checked in (saved with 0 claims)
    const receiptIdToTripId = {}
    for (const r of allReceipts) receiptIdToTripId[r.id] = r.trip_id
    const itemIdToReceiptId = {}
    for (const item of allItems) itemIdToReceiptId[item.id] = item.receipt_id
    const map = {}
    for (const claim of allClaims) {
      const tripId = receiptIdToTripId[itemIdToReceiptId[claim.item_id]]
      if (!tripId) continue
      if (!map[tripId]) map[tripId] = new Set()
      map[tripId].add(claim.roommate.toLowerCase())
    }
    for (const checkin of allCheckins) {
      if (!map[checkin.trip_id]) map[checkin.trip_id] = new Set()
      map[checkin.trip_id].add(checkin.roommate.toLowerCase())
    }
    setClaimersByTrip(map)

    const data = { trips, allReceipts, allItems, allClaims, settlements, allMeals }
    setRawData(data)
    computeDebts(localStorage.getItem('global-name') || '', data)
    setLoading(false)
  }

  function computeDebts(name, { trips, allReceipts, allItems, allClaims, settlements, allMeals = [] }) {
    if (!name) { setNetByPerson({}); return }

    const nameLc = name.toLowerCase()
    const byPerson = {} // keyed by lowercase name

    for (const trip of trips) {
      const tripReceipts = allReceipts.filter(r => r.trip_id === trip.id)
      if (!tripReceipts.length) continue
      const receiptIds = new Set(tripReceipts.map(r => r.id))
      const tripItems = allItems.filter(i => receiptIds.has(i.receipt_id))
      if (!tripItems.length) continue
      const itemIds = new Set(tripItems.map(i => i.id))
      const tripClaims = allClaims.filter(c => itemIds.has(c.item_id))

      const tripReceiptIds = new Set(tripReceipts.map(r => r.id))
      const tripMeals = allMeals.filter(m => tripReceiptIds.has(m.receipt_id))
      for (const debt of calculateDebts(tripReceipts, tripItems, tripClaims, tripMeals)) {
        const settled = settlements.some(
          s => s.trip_id === trip.id
            && s.debtor.toLowerCase() === debt.debtor.toLowerCase()
            && s.creditor.toLowerCase() === debt.creditor.toLowerCase()
        )

        if (debt.creditor.toLowerCase() === nameLc) {
          const person = debt.debtor.toLowerCase()
          if (!byPerson[person]) byPerson[person] = { net: 0, theyOweMe: [], iOweThem: [] }
          byPerson[person].theyOweMe.push({ ...debt, tripName: trip.name, tripId: trip.id, settled })
          byPerson[person].net += debt.amount
        }
        if (debt.debtor.toLowerCase() === nameLc) {
          const person = debt.creditor.toLowerCase()
          if (!byPerson[person]) byPerson[person] = { net: 0, theyOweMe: [], iOweThem: [] }
          byPerson[person].iOweThem.push({ ...debt, tripName: trip.name, tripId: trip.id, settled })
          byPerson[person].net -= debt.amount
        }
      }
    }

    setNetByPerson(byPerson)
  }

  const toTitleCase = s => s.replace(/\b\w/g, c => c.toUpperCase())

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

  function toggleMember(name) {
    setMembers(prev =>
      prev.includes(name) ? prev.filter(m => m !== name) : [...prev, name]
    )
  }

  function addCustomMember(e) {
    e.preventDefault()
    const name = newMemberInput.trim()
    if (!name || members.includes(name)) { setNewMemberInput(''); return }
    setMembers(prev => [...prev, name])
    setNewMemberInput('')
  }

  function resetForm() {
    setShowForm(false)
    setTripName('')
    setMembers(coreRoommates)
    setNewMemberInput('')
  }

  async function markSettled(tripId, creditor) {
    setSettling({ tripId, creditor })
    await supabase.from('settlements').upsert(
      { trip_id: tripId, debtor: myName, creditor },
      { onConflict: 'trip_id,debtor,creditor' }
    )
    await fetchTrips()
    setSettling(null)
  }

  async function markAllSettledWith(person, data) {
    setSettling({ person })
    const upserts = [
      // Trips where I owe them → I sent money
      ...data.iOweThem.map(e => ({ trip_id: e.tripId, debtor: myName, creditor: person })),
      // Trips where they owe me (offsets) → mark as settled from their side too
      ...data.theyOweMe.map(e => ({ trip_id: e.tripId, debtor: person, creditor: myName })),
    ]
    await supabase.from('settlements').upsert(upserts, { onConflict: 'trip_id,debtor,creditor' })
    await fetchTrips()
    setSettling(null)
  }

  async function createTrip(e) {
    e.preventDefault()
    const name = tripName.trim() || `Grocery run – ${today}`
    setCreating(true)
    const { data, error } = await supabase
      .from('trips')
      .insert({ name, members })
      .select()
      .single()
    setCreating(false)
    if (error) { await showAlert(error.message, { title: 'Failed to create trip' }); return }
    navigate(`/trip/${data.id}`)
  }

  const iOweTotal = iOweEntries.reduce((s, [, d]) => s + unsettledIOwe(d), 0)

  function renderTripRow(trip) {
    const claimers = claimersByTrip[trip.id] || new Set()
    const waitingOn = claimers.size > 0 && !trip.closed
      ? (trip.members || []).filter(m => !claimers.has(m.toLowerCase()))
      : []

    return (
      <li key={trip.id}>
        <Link
          to={`/trip/${trip.id}`}
          className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-accent-300 hover:shadow-sm transition"
        >
          <div className="min-w-0">
            <p className="font-medium text-gray-900">{trip.name}</p>
            <p className="text-xs text-gray-400">
              {new Date(trip.created_at).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
              })}
            </p>
            {waitingOn.length > 0 && (
              <p className="text-xs text-amber-600 mt-0.5">
                Waiting on: {waitingOn.join(', ')}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 ml-3 shrink-0">
            {trip.closed && (
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Closed</span>
            )}
            <span className="text-gray-300">›</span>
          </div>
        </Link>
      </li>
    )
  }

  return (
    <>
    {DialogUI}
    <div className="max-w-xl mx-auto p-4 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-1">Receipts</h1>
          <p className="text-gray-500">Fair grocery splits for roommates.</p>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className="mt-1 shrink-0 text-sm px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition"
        >
          + New Trip
        </button>
      </div>

      {/* New trip form */}
      {showForm && (
        <form onSubmit={createTrip} className="mb-6 bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Trip name</label>
            <input
              type="text"
              value={tripName}
              onChange={e => setTripName(e.target.value)}
              placeholder={`Grocery run – ${today}`}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-400"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Who's on this trip?</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {[...new Set([...coreRoommates, ...members])].map(name => {
                const selected = members.includes(name)
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleMember(name)}
                    className={`px-3 py-1 rounded-full text-sm font-medium border transition ${
                      selected
                        ? 'bg-accent-600 text-white border-accent-600'
                        : 'bg-white text-gray-500 border-gray-300 hover:border-accent-400'
                    }`}
                  >
                    {name}
                  </button>
                )
              })}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newMemberInput}
                onChange={e => setNewMemberInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCustomMember(e)}
                placeholder="Add someone…"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
              />
              <button
                type="button"
                onClick={addCustomMember}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition text-gray-600"
              >
                Add
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creating}
              className="flex-1 py-2 bg-accent-600 text-white font-semibold rounded-lg hover:bg-accent-700 transition disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create Trip'}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

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
                              to={`/trip/${entry.tripId}`}
                              className="text-gray-700 hover:underline"
                              onClick={e => e.stopPropagation()}
                            >
                              {entry.tripName}
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
                              to={`/trip/${entry.tripId}`}
                              className="text-gray-700 hover:underline"
                              onClick={e => e.stopPropagation()}
                            >
                              {entry.tripName}
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
                      {data.iOweThem.map((entry, i) => {
                        const isSettling = settling?.tripId === entry.tripId && settling?.creditor === person
                        return (
                          <div key={i} className="flex items-center justify-between text-sm gap-2">
                            <div className="min-w-0">
                              <Link
                                to={`/trip/${entry.tripId}`}
                                className="text-gray-700 hover:underline"
                                onClick={e => e.stopPropagation()}
                              >
                                {entry.tripName}
                              </Link>
                              <span className="text-gray-400 text-xs ml-1.5">you owe</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-gray-900">${entry.amount.toFixed(2)}</span>
                              {entry.settled ? (
                                <span className="text-xs text-accent-600 font-medium">✓ sent</span>
                              ) : (
                                <button
                                  onClick={() => markSettled(entry.tripId, person)}
                                  disabled={!!settling}
                                  className="text-xs px-2 py-0.5 border border-accent-200 text-accent-600 rounded-md hover:bg-accent-50 transition disabled:opacity-50"
                                >
                                  {isSettling ? '…' : 'Mark sent'}
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                      {data.theyOweMe.map((entry, i) => (
                        <div key={i} className="flex items-center justify-between text-sm gap-2">
                          <div className="min-w-0">
                            <Link
                              to={`/trip/${entry.tripId}`}
                              className="text-gray-700 hover:underline"
                              onClick={e => e.stopPropagation()}
                            >
                              {entry.tripName}
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

      {/* Calendar */}
      {(() => {
        const now = new Date()
        const isCurrentMonth = calMonth.year === now.getFullYear() && calMonth.month === now.getMonth()

        // Group trips by local date key
        const tripsByDate = {}
        for (const trip of trips) {
          const d = new Date(trip.created_at)
          const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
          if (!tripsByDate[key]) tripsByDate[key] = []
          tripsByDate[key].push(trip)
        }

        // Build calendar day array (nulls for padding before month start)
        const firstDay = new Date(calMonth.year, calMonth.month, 1)
        const daysInMonth = new Date(calMonth.year, calMonth.month + 1, 0).getDate()
        const calDays = [
          ...Array(firstDay.getDay()).fill(null),
          ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
        ]

        return (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <button
                onClick={() => setCalMonth(prev => {
                  const d = new Date(prev.year, prev.month - 1, 1)
                  return { year: d.getFullYear(), month: d.getMonth() }
                })}
                className="p-1.5 hover:bg-gray-100 rounded-lg transition text-gray-500"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="flex items-center gap-3">
                <h2 className="font-semibold text-gray-800">
                  {firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </h2>
                {!isCurrentMonth && (
                  <button
                    onClick={() => setCalMonth({ year: now.getFullYear(), month: now.getMonth() })}
                    className="text-xs text-accent-500 hover:text-accent-700 transition"
                  >
                    Today
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowAllTrips(s => !s)}
                  className="text-xs text-gray-400 hover:text-gray-600 transition mr-1"
                  title={showAllTrips ? 'Showing all trips' : 'Showing only your trips'}
                >
                  {showAllTrips ? 'All' : 'Mine'}
                </button>
                <button
                  onClick={() => setCalMonth(prev => {
                    const d = new Date(prev.year, prev.month + 1, 1)
                    return { year: d.getFullYear(), month: d.getMonth() }
                  })}
                  className="p-1.5 hover:bg-gray-100 rounded-lg transition text-gray-500"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Day-of-week headers */}
            <div className="grid grid-cols-7 border-b border-gray-100">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <div key={d} className="text-center text-xs font-medium text-gray-400 py-2">{d}</div>
              ))}
            </div>

            {/* Grid */}
            {loading ? (
              <p className="text-gray-400 text-sm p-4">Loading…</p>
            ) : (
              <div className="grid grid-cols-7 divide-x divide-y divide-gray-100">
                {calDays.map((day, i) => {
                  if (!day) return <div key={`pad-${i}`} className="min-h-16 bg-gray-50/60" />

                  const key = `${calMonth.year}-${calMonth.month}-${day}`
                  const dayDate = new Date(calMonth.year, calMonth.month, day)
                  const isToday = dayDate.toDateString() === now.toDateString()
                  const dayTrips = (tripsByDate[key] || []).filter(trip =>
                    showAllTrips || !myName || (trip.members || []).some(m => m.toLowerCase() === myName.toLowerCase())
                  )

                  return (
                    <div key={key} className={`min-h-16 p-1 ${isToday ? 'bg-accent-50/60' : ''}`}>
                      <div className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1 mx-auto ${
                        isToday ? 'bg-accent-600 text-white' : 'text-gray-400'
                      }`}>
                        {day}
                      </div>
                      <div className="space-y-0.5">
                        {dayTrips.map(trip => {
                          const claimers = claimersByTrip[trip.id] || new Set()
                          const waitingOn = claimers.size > 0 && !trip.closed
                            ? (trip.members || []).filter(m => !claimers.has(m.toLowerCase()))
                            : []
                          return (
                            <Link
                              key={trip.id}
                              to={`/trip/${trip.id}`}
                              className={`block text-xs px-1.5 py-0.5 rounded truncate leading-5 ${
                                trip.closed
                                  ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                  : waitingOn.length > 0
                                    ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
                                    : 'bg-accent-50 text-accent-700 border border-accent-100 hover:bg-accent-100'
                              }`}
                            >
                              {trip.name}
                            </Link>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}
      <p className="mt-8 text-center text-xs text-gray-300">v{buildVersion}</p>
    </div>
    </>
  )
}
