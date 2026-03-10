import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

export default function Home() {
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [tripName, setTripName] = useState('')
  const [showForm, setShowForm] = useState(false)
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
    const { data, error } = await supabase
      .from('trips')
      .select('*')
      .order('created_at', { ascending: false })

    if (!error) setTrips(data)
    setLoading(false)
  }

  async function createTrip(e) {
    e.preventDefault()
    const name = tripName.trim() || `Grocery run – ${today}`
    setCreating(true)

    const { data, error } = await supabase
      .from('trips')
      .insert({ name })
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
        <form onSubmit={createTrip} className="mb-8 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <label className="block text-sm font-medium text-gray-700 mb-1">Trip name</label>
          <input
            type="text"
            value={tripName}
            onChange={e => setTripName(e.target.value)}
            placeholder={`Grocery run – ${today}`}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            autoFocus
          />
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
              onClick={() => setShowForm(false)}
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
          {trips.map(trip => (
            <li key={trip.id}>
              <Link
                to={`/trip/${trip.id}`}
                className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-indigo-300 hover:shadow-sm transition"
              >
                <div>
                  <p className="font-medium text-gray-900">{trip.name}</p>
                  <p className="text-xs text-gray-400">
                    {new Date(trip.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {trip.closed && (
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Closed</span>
                  )}
                  <span className="text-gray-300">›</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
