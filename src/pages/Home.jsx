import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

const DEFAULT_MEMBERS = ['Alex', 'Clouey', 'Milo', 'Niko']

export default function Home() {
  const [trips, setTrips] = useState([])
  const [claimersByTrip, setClaimersByTrip] = useState({})
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [tripName, setTripName] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [members, setMembers] = useState([...DEFAULT_MEMBERS])
  const [newMemberInput, setNewMemberInput] = useState('')
  const navigate = useNavigate()

  const today = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  useEffect(() => {
    fetchTrips()
  }, [])

  async function fetchTrips() {
    const [tripsRes, claimsRes] = await Promise.all([
      supabase.from('trips').select('*').order('created_at', { ascending: false }),
      supabase.from('claims').select('roommate, items!inner(receipts!inner(trip_id))'),
    ])

    if (!tripsRes.error) setTrips(tripsRes.data)

    // Build map of trip_id → Set of claimers
    const map = {}
    for (const claim of claimsRes.data || []) {
      const tripId = claim.items?.receipts?.trip_id
      if (!tripId) continue
      if (!map[tripId]) map[tripId] = new Set()
      map[tripId].add(claim.roommate)
    }
    setClaimersByTrip(map)

    setLoading(false)
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
    if (error) {
      alert('Failed to create trip: ' + error.message)
      return
    }
    navigate(`/trip/${data.id}`)
  }

  return (
    <div className="max-w-xl mx-auto p-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-1">Whip Out the Receipts</h1>
      <p className="text-gray-500 mb-6">Fair grocery splits for roommates.</p>

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition mb-8"
        >
          + New Trip
        </button>
      ) : (
        <form onSubmit={createTrip} className="mb-8 bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-4">
          {/* Trip name */}
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

          {/* Members */}
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
            {/* Add a custom member */}
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

      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Trip History</h2>
      {loading ? (
        <p className="text-gray-400">Loading…</p>
      ) : trips.length === 0 ? (
        <p className="text-gray-400">No trips yet. Create one above!</p>
      ) : (
        <ul className="space-y-2">
          {trips.map(trip => {
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
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
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
          })}
        </ul>
      )}
    </div>
  )
}
