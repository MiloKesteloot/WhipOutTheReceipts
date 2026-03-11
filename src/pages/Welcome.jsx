import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function Welcome({ onNameSet }) {
  const [name, setName] = useState('')
  const [knownNames, setKnownNames] = useState([])

  useEffect(() => {
    async function loadNames() {
      const [receiptsRes, claimsRes] = await Promise.all([
        supabase.from('receipts').select('paid_by'),
        supabase.from('claims').select('roommate'),
      ])
      const names = new Set([
        ...(receiptsRes.data || []).map(r => r.paid_by),
        ...(claimsRes.data || []).map(c => c.roommate),
      ].filter(Boolean))
      setKnownNames([...names].sort())
    }
    loadNames()
  }, [])

  function handleSubmit(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onNameSet(trimmed)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Whip Out the Receipts</h1>
          <p className="text-gray-500">Fair grocery splits for roommates.</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800 mb-1">Who are you?</h2>
          <p className="text-sm text-gray-400 mb-4">
            Your name is used to track what you've claimed and what you owe across all trips.
          </p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              list="known-names"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Enter your name"
              className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-gray-900"
              autoFocus
            />
            <datalist id="known-names">
              {knownNames.map(n => <option key={n} value={n} />)}
            </datalist>
            <button
              type="submit"
              disabled={!name.trim()}
              className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition disabled:opacity-40"
            >
              Get started →
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
