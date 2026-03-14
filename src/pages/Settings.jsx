import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const FALLBACK_CORE = ['Alex', 'Clouey', 'Milo', 'Niko']
const SETTINGS_KEY = 'apartment_members'

// Async — used by Stats and Home on mount to get the current core list
export async function fetchCoreRoommates() {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', SETTINGS_KEY)
      .single()
    if (data?.value) {
      return data.value.filter(m => m.isCore).map(m => m.name)
    }
  } catch {}
  return FALLBACK_CORE
}

export default function Settings() {
  const currentName = localStorage.getItem('global-name') || ''
  const [nameInput, setNameInput] = useState(currentName)

  // Apartment settings — loaded from DB, null = still loading
  const [roster, setRoster] = useState(null)
  const [newPersonInput, setNewPersonInput] = useState('')
  const saveTimerRef = useRef(null)

  // Personal settings — localStorage only
  const [defaultShowAll, setDefaultShowAll] = useState(
    localStorage.getItem('default-show-all-trips') === '1'
  )

  useEffect(() => { loadRoster() }, [])

  async function loadRoster() {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', SETTINGS_KEY)
      .single()
    if (data?.value) {
      setRoster(data.value)
    } else {
      const initial = FALLBACK_CORE.map(name => ({ name, isCore: true }))
      setRoster(initial)
      await persistRoster(initial)
    }
  }

  async function persistRoster(r) {
    await supabase.from('app_settings').upsert(
      { key: SETTINGS_KEY, value: r },
      { onConflict: 'key' }
    )
  }

  function updateRoster(newRoster) {
    setRoster(newRoster)
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => persistRoster(newRoster), 400)
  }

  function toggleCore(name) {
    updateRoster(roster.map(m => m.name === name ? { ...m, isCore: !m.isCore } : m))
  }

  function deletePerson(name) {
    updateRoster(roster.filter(m => m.name !== name))
  }

  function addNewPerson(e) {
    e.preventDefault()
    const name = newPersonInput.trim().replace(/\b\w/g, c => c.toUpperCase())
    if (!name || roster.some(m => m.name.toLowerCase() === name.toLowerCase())) {
      setNewPersonInput('')
      return
    }
    updateRoster([...roster, { name, isCore: true }])
    setNewPersonInput('')
  }

  function saveName() {
    const normalized = nameInput.trim().replace(/\b\w/g, c => c.toUpperCase())
    if (!normalized || normalized === currentName) return
    localStorage.setItem('global-name', normalized)
    window.location.reload()
  }

  useEffect(() => {
    localStorage.setItem('default-show-all-trips', defaultShowAll ? '1' : '0')
  }, [defaultShowAll])

  return (
    <div className="max-w-xl mx-auto p-4 py-8 space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Your Name */}
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

      {/* Apartment Settings */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-1">Apartment settings</h2>
        <p className="text-xs text-gray-400 mb-3">Changes here apply to everyone in the apartment.</p>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-sm font-medium text-gray-700 mb-1">Roommate roster</p>
          <p className="text-xs text-gray-400 mb-4">Checked roommates appear by default in Stats and as quick-add options when creating a trip.</p>
          {roster === null ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <div className="space-y-2">
              {roster.map(({ name, isCore }) => (
                <div key={name} className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id={`core-${name}`}
                    checked={isCore}
                    onChange={() => toggleCore(name)}
                    className="h-4 w-4 rounded accent-indigo-600 cursor-pointer"
                  />
                  <label htmlFor={`core-${name}`} className="flex-1 text-sm text-gray-800 cursor-pointer">
                    {name}
                  </label>
                  <button
                    onClick={() => deletePerson(name)}
                    className="text-gray-300 hover:text-red-400 transition p-1 rounded"
                    title={`Remove ${name}`}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
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

      {/* Personal Settings */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-1">Personal settings</h2>
        <p className="text-xs text-gray-400 mb-3">Saved on this device only.</p>
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
