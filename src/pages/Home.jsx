import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { calculateDebts } from '../lib/splitLogic.js'

const DEFAULT_MEMBERS = ['Alex', 'Clouey', 'Milo', 'Niko']

export default function Home() {
  const [trips, setTrips] = useState([])
  const [claimersByTrip, setClaimersByTrip] = useState({})
  const [tripsWithItems, setTripsWithItems] = useState(new Set())
  const [owedToMe, setOwedToMe] = useState([])
  const [iOwe, setIOwe] = useState([])
  const [rawData, setRawData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [settling, setSettling] = useState(null) // { tripId, creditor }
  const [tripName, setTripName] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [members, setMembers] = useState([...DEFAULT_MEMBERS])
  const [newMemberInput, setNewMemberInput] = useState('')
  const myName = localStorage.getItem('global-name') || ''
  const navigate = useNavigate()

  const today = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })

  useEffect(() => {
    fetchTrips()
  }, [])

  useEffect(() => {
    if (rawData) computeDebts(myName, rawData)
  }, [rawData])

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
      map[tripId].add(claim.roommate)
    }
    setClaimersByTrip(map)

    // Track which trips have items
    const twi = new Set()
    for (const r of allReceipts) twi.add(r.trip_id)
    setTripsWithItems(twi)

    const data = { trips, allReceipts, allItems, allClaims, settlements }
    setRawData(data)
    computeDebts(localStorage.getItem('global-name') || '', data)

    setLoading(false)
  }

  function computeDebts(name, { trips, allReceipts, allItems, allClaims, settlements }) {
    if (!name) { setOwedToMe([]); setIOwe([]); return }

    const owedResult = []
    const iOweResult = []

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
          s => s.trip_id === trip.id && s.debtor === debt.debtor && s.creditor === debt.creditor
        )
        if (debt.creditor === name) {
          owedResult.push({ ...debt, tripName: trip.name, tripId: trip.id, settled })
        }
        if (debt.debtor === name) {
          iOweResult.push({ ...debt, tripName: trip.name, tripId: trip.id, settled })
        }
      }
    }

    setOwedToMe(owedResult)
    setIOwe(iOweResult)
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

  const pendingTotal = owedToMe.filter(e => !e.settled).reduce((s, e) => s + e.amount, 0)

  // Trips that need the user's attention
  const actionTripIds = new Set()
  if (myName) {
    for (const trip of trips) {
      if (trip.closed) continue
      if (!(trip.members || []).includes(myName)) continue
      if (!tripsWithItems.has(trip.id)) continue
      const claimers = claimersByTrip[trip.id] || new Set()
      if (!claimers.has(myName)) actionTripIds.add(trip.id)
    }
    for (const debt of iOwe) {
      if (!debt.settled) actionTripIds.add(debt.tripId)
    }
  }
  const actionTrips = trips.filter(t => actionTripIds.has(t.id))

  function renderTripRow(trip, { showReasons = false } = {}) {
    const claimers = claimersByTrip[trip.id] || new Set()
    const waitingOn = claimers.size > 0 && !trip.closed
      ? (trip.members || []).filter(m => !claimers.has(m))
      : []

    const needsClaiming = showReasons && myName && !trip.closed
      && (trip.members || []).includes(myName)
      && !claimers.has(myName)
      && tripsWithItems.has(trip.id)
    const unsettledDebt = showReasons
      ? iOwe.filter(d => d.tripId === trip.id && !d.settled)
      : []

    if (showReasons) {
      return (
        <li key={trip.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <Link to={`/trip/${trip.id}`} className="font-medium text-gray-900 hover:underline">{trip.name}</Link>
              <p className="text-xs text-gray-400">
                {new Date(trip.created_at).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric',
                })}
              </p>
            </div>
          </div>
          <div className="mt-2 space-y-1.5">
            {needsClaiming && (
              <p className="text-xs text-indigo-600 font-medium">Check off your items</p>
            )}
            {unsettledDebt.map((d, i) => {
              const isSettling = settling?.tripId === trip.id && settling?.creditor === d.creditor
              return (
                <div key={i} className="flex items-center justify-between gap-2">
                  <p className="text-xs text-amber-600">
                    Owe ${d.amount.toFixed(2)} to {d.creditor}
                  </p>
                  <button
                    onClick={() => markSettled(trip.id, d.creditor)}
                    disabled={!!settling}
                    className="shrink-0 text-xs px-2 py-0.5 border border-gray-200 rounded-md text-gray-500 hover:bg-gray-50 transition disabled:opacity-50"
                  >
                    {isSettling ? '…' : 'Mark sent'}
                  </button>
                </div>
              )
            })}
          </div>
        </li>
      )
    }

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

      {/* People who owe you */}
      {myName && owedToMe.length > 0 && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-800">People who owe you</h2>
            {pendingTotal > 0 && (
              <span className="text-sm font-semibold text-indigo-600">${pendingTotal.toFixed(2)} pending</span>
            )}
          </div>
          <ul className="space-y-2">
            {owedToMe.map((entry, i) => (
              <li key={i} className="flex items-center justify-between text-sm gap-2">
                <div className="min-w-0">
                  <span className={`font-medium ${entry.settled ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                    {entry.debtor}
                  </span>
                  <Link
                    to={`/trip/${entry.tripId}`}
                    className="ml-1.5 text-xs text-indigo-400 hover:text-indigo-600 hover:underline"
                    onClick={e => e.stopPropagation()}
                  >
                    {entry.tripName}
                  </Link>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`font-semibold ${entry.settled ? 'text-gray-400' : 'text-gray-900'}`}>
                    ${entry.amount.toFixed(2)}
                  </span>
                  {entry.settled
                    ? <span className="text-xs text-green-600 font-medium">✓ Sent</span>
                    : <span className="text-xs text-amber-500">awaiting</span>
                  }
                </div>
              </li>
            ))}
          </ul>
          {owedToMe.every(e => e.settled) && (
            <p className="text-xs text-green-600 mt-3 font-medium">All paid up ✓</p>
          )}
        </div>
      )}

      {/* Trips needing attention */}
      {!loading && actionTrips.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Needs your attention</h2>
          <ul className="space-y-2">
            {actionTrips.map(trip => renderTripRow(trip, { showReasons: true }))}
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
