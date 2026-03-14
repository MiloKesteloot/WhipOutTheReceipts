import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const FALLBACK_CORE = ['Alex', 'Clouey', 'Milo', 'Niko']

export function getCoreRoommates() {
  try {
    const stored = localStorage.getItem('core-roommates')
    return stored ? JSON.parse(stored) : FALLBACK_CORE
  } catch { return FALLBACK_CORE }
}

export default function Settings() {
  const currentName = localStorage.getItem('global-name') || ''
  const [nameInput, setNameInput] = useState(currentName)

  const [allPeople, setAllPeople] = useState([])
  const [coreSet, setCoreSet] = useState(() =>
    new Set(getCoreRoommates().map(n => n.toLowerCase()))
  )
  const [loadingPeople, setLoadingPeople] = useState(true)
  const [newPersonInput, setNewPersonInput] = useState('')

  const [defaultShowAll, setDefaultShowAll] = useState(
    localStorage.getItem('default-show-all-trips') === '1'
  )

  useEffect(() => {
    async function loadPeople() {
      const [tripsRes, claimsRes, receiptsRes] = await Promise.all([
        supabase.from('trips').select('members'),
        supabase.from('claims').select('roommate'),
        supabase.from('receipts').select('paid_by'),
      ])

      const fromMembers = (tripsRes.data || []).flatMap(t => t.members || []).filter(m => typeof m === 'string')
      const fromClaims = (claimsRes.data || []).map(c => c.roommate).filter(Boolean)
      const fromPayers = (receiptsRes.data || []).map(r => r.paid_by).filter(Boolean)

      const allNames = [...new Set([...getCoreRoommates(), ...fromMembers, ...fromClaims, ...fromPayers])]
        .filter(p => typeof p === 'string' && p.trim())
        .sort((a, b) => a.localeCompare(b))

      setAllPeople(allNames)
      setLoadingPeople(false)
    }
    loadPeople()
  }, [])

  // Persist core roommates whenever coreSet or allPeople changes
  useEffect(() => {
    const coreNames = allPeople.filter(p => coreSet.has(p.toLowerCase()))
    if (coreNames.length > 0) {
      localStorage.setItem('core-roommates', JSON.stringify(coreNames))
    }
  }, [coreSet, allPeople])

  useEffect(() => {
    localStorage.setItem('default-show-all-trips', defaultShowAll ? '1' : '0')
  }, [defaultShowAll])

  function saveName() {
    const normalized = nameInput.trim().replace(/\b\w/g, c => c.toUpperCase())
    if (!normalized || normalized === currentName) return
    localStorage.setItem('global-name', normalized)
    window.location.reload()
  }

  function toggleCore(person) {
    if (person.toLowerCase() === currentName.toLowerCase()) return
    const key = person.toLowerCase()
    setCoreSet(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function addNewPerson(e) {
    e.preventDefault()
    const name = newPersonInput.trim().replace(/\b\w/g, c => c.toUpperCase())
    if (!name) return
    setAllPeople(prev => {
      if (prev.some(p => p.toLowerCase() === name.toLowerCase())) return prev
      return [...prev, name].sort((a, b) => a.localeCompare(b))
    })
    setCoreSet(prev => new Set([...prev, name.toLowerCase()]))
    setNewPersonInput('')
  }

  return (
    <div className="max-w-xl mx-auto p-4 py-8 space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Your name */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Your name</h2>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveName()}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <button
              onClick={saveName}
              disabled={!nameInput.trim() || nameInput.trim().replace(/\b\w/g, c => c.toUpperCase()) === currentName}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition disabled:opacity-40"
            >
              Save
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">Changing your name will reload the page.</p>
        </div>
      </section>

      {/* Core roommates */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-1">Core roommates</h2>
        <p className="text-xs text-gray-400 mb-3">
          Checked people appear by default in Stats and as quick-add options when creating a trip. Friends who join occasionally can be left unchecked.
        </p>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          {loadingPeople ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <div className="space-y-2">
              {allPeople.map(person => {
                const isCore = coreSet.has(person.toLowerCase())
                const isYou = person.toLowerCase() === currentName.toLowerCase()
                return (
                  <label
                    key={person}
                    className={`flex items-center gap-3 py-0.5 ${isYou ? '' : 'cursor-pointer'}`}
                  >
                    <input
                      type="checkbox"
                      checked={isCore}
                      disabled={isYou}
                      onChange={() => toggleCore(person)}
                      className="h-4 w-4 rounded accent-indigo-600"
                    />
                    <span className="text-sm text-gray-800">{person}</span>
                    {isYou && <span className="text-xs text-gray-400">(you)</span>}
                  </label>
                )
              })}
              <form onSubmit={addNewPerson} className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                <input
                  type="text"
                  value={newPersonInput}
                  onChange={e => setNewPersonInput(e.target.value)}
                  placeholder="Add a person…"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition text-gray-600"
                >
                  Add
                </button>
              </form>
            </div>
          )}
        </div>
      </section>

      {/* Default trip view */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Trips</h2>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium text-gray-800">Show all trips by default</p>
              <p className="text-xs text-gray-400 mt-0.5">When off, only trips you're a member of are shown on the home page</p>
            </div>
            <button
              onClick={() => setDefaultShowAll(v => !v)}
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ml-4 ${defaultShowAll ? 'bg-indigo-500' : 'bg-gray-200'}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${defaultShowAll ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </label>
        </div>
      </section>
    </div>
  )
}
