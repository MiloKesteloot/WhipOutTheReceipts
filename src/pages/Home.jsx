import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { calculateDebts } from '../lib/splitLogic.js'

const DEFAULT_MEMBERS = ['Alex', 'Clouey', 'Milo', 'Niko']

export default function Home() {
  const [trips, setTrips] = useState([])
  const [claimersByTrip, setClaimersByTrip] = useState({})
  const [tripsWithItems, setTripsWithItems] = useState(new Set())
  // person -> { net, theyOweMe: [...], iOweThem: [...] }
  const [netByPerson, setNetByPerson] = useState({})
  const [rawData, setRawData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [settling, setSettling] = useState(null)
  const [tripName, setTripName] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [members, setMembers] = useState([...DEFAULT_MEMBERS])
  const [newMemberInput, setNewMemberInput] = useState('')
  const [expandedPeople, setExpandedPeople] = useState(new Set())
  const myName = localStorage.getItem('global-name') || ''
  const navigate = useNavigate()

  const today = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })

  useEffect(() => { fetchTrips() }, [])
  useEffect(() => { if (rawData) computeDebts(myName, rawData) }, [rawData])

  async function fetchTrips() {
    const [tripsRes, receiptsRes, itemsRes, claimsRes, settlementsRes] = await Promise.all([
      supabase.from('trips').select('*').order('created_at', { ascending: false }),
      supabase.from('receipts').select('id, trip_id, paid_by, tip, tax'),
      supabase.from('items').select('id, receipt_id, price'),
      supabase.from('claims').select('item_id, roommate'),
      supabase.from('settlements').select('trip_id, debtor, creditor'),
    ])

    const trips = tripsRes.data || []
    const allReceipts = receiptsRes.data || []
    const allItems = itemsRes.data || []
    const allClaims = claimsRes.data || []
    const settlements = settlementsRes.data || []

    setTrips(trips)

    // Build claimersByTrip
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
    setClaimersByTrip(map)

    const twi = new Set()
    for (const r of allReceipts) twi.add(r.trip_id)
    setTripsWithItems(twi)

    const data = { trips, allReceipts, allItems, allClaims, settlements }
    setRawData(data)
    computeDebts(localStorage.getItem('global-name') || '', data)
    setLoading(false)
  }

  function computeDebts(name, { trips, allReceipts, allItems, allClaims, settlements }) {
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

      for (const debt of calculateDebts(tripReceipts, tripItems, tripClaims)) {
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
    setMembers([...DEFAULT_MEMBERS])
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
    if (error) { alert('Failed to create trip: ' + error.message); return }
    navigate(`/trip/${data.id}`)
  }

  const iOweTotal = iOweEntries.reduce((s, [, d]) => s + unsettledIOwe(d), 0)

  function renderTripRow(trip) {
    const claimers = claimersByTrip[trip.id] || new Set()
    const waitingOn = claimers.size > 0 && !trip.closed
      ? (trip.members || []).filter(m => !claimers.has(m))
      : []

    return (
      <li key={trip.id}>
        <Link
          to={`/trip/${trip.id}`}
          className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-indigo-300 hover:shadow-sm transition"
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
    <div className="max-w-xl mx-auto p-4 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-1">Whip Out the Receipts</h1>
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Who's on this trip?</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {[...new Set([...DEFAULT_MEMBERS, ...members])].map(name => {
                const selected = members.includes(name)
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleMember(name)}
                    className={`px-3 py-1 rounded-full text-sm font-medium border transition ${
                      selected
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-500 border-gray-300 hover:border-indigo-400'
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
                className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
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
              className="flex-1 py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
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
            <span className="text-sm font-semibold text-indigo-600">${pendingTotal.toFixed(2)}</span>
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
                      <span className="text-gray-300 text-xs">{expanded ? '▲' : '▼'}</span>
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
                              ? <span className="text-xs text-green-600 font-medium">✓ sent</span>
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
                            <span className="text-gray-400 text-xs ml-1.5">you owe (offset)</span>
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
                      <span className="text-gray-300 text-xs">{expanded ? '▲' : '▼'}</span>
                    </div>
                  </button>
                  {expanded && (
                    <div className="border-t border-gray-100 px-3 py-2 space-y-1.5">
                      {data.iOweThem.every(e => e.settled) && data.theyOweMe.every(e => e.settled) ? (
                        <p className="text-xs text-green-600 font-medium py-1">All settled ✓</p>
                      ) : (
                        <button
                          onClick={() => markAllSettledWith(person, data)}
                          disabled={!!settling}
                          className="w-full text-sm py-1.5 px-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 font-medium"
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
                                <span className="text-xs text-green-600 font-medium">✓ sent</span>
                              ) : (
                                <button
                                  onClick={() => markSettled(entry.tripId, person)}
                                  disabled={!!settling}
                                  className="text-xs px-2 py-0.5 border border-gray-200 rounded-md text-gray-500 hover:bg-gray-50 transition disabled:opacity-50"
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
                            <span className="text-gray-400 text-xs ml-1.5">they owe you (offset)</span>
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

      {/* All trips */}
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">All Trips</h2>
      {loading ? (
        <p className="text-gray-400">Loading…</p>
      ) : trips.length === 0 ? (
        <p className="text-gray-400">No trips yet. Hit "+ New Trip" above to get started.</p>
      ) : (
        <ul className="space-y-2">
          {trips.map(trip => renderTripRow(trip))}
        </ul>
      )}
    </div>
  )
}
