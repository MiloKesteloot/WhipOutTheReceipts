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

  // Name input dropdown
  const [nameOpen, setNameOpen] = useState(false)
  const nameInputRef = useRef(null)

  // Merge tool
  const [allKnownNames, setAllKnownNames] = useState([])
  const [mergeFrom, setMergeFrom] = useState('')
  const [mergeTo, setMergeTo] = useState('')
  const [merging, setMerging] = useState(false)
  const [mergeConfirm, setMergeConfirm] = useState(false)
  const [mergeDone, setMergeDone] = useState(null)

  // Personal settings — localStorage only
  const [defaultShowAll, setDefaultShowAll] = useState(
    localStorage.getItem('default-show-all-trips') === '1'
  )
  const [geminiKey, setGeminiKey] = useState(localStorage.getItem('gemini-api-key') || '')
  const [geminiKeySaved, setGeminiKeySaved] = useState(false)

  useEffect(() => { loadRoster(); loadAllKnownNames() }, [])

  useEffect(() => {
    function handleClick(e) {
      if (nameInputRef.current && !nameInputRef.current.contains(e.target)) {
        setNameOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function loadAllKnownNames() {
    const [tripsRes, claimsRes, receiptsRes, settlementsRes] = await Promise.all([
      supabase.from('trips').select('members'),
      supabase.from('claims').select('roommate'),
      supabase.from('receipts').select('paid_by'),
      supabase.from('settlements').select('debtor, creditor'),
    ])
    const names = new Set()
    for (const t of tripsRes.data || []) (t.members || []).forEach(m => m && names.add(m))
    for (const c of claimsRes.data || []) c.roommate && names.add(c.roommate)
    for (const r of receiptsRes.data || []) r.paid_by && names.add(r.paid_by)
    for (const s of settlementsRes.data || []) {
      s.debtor && names.add(s.debtor)
      s.creditor && names.add(s.creditor)
    }
    setAllKnownNames([...names].sort((a, b) => a.localeCompare(b)))
  }

  async function mergeNames() {
    if (!mergeFrom || !mergeTo || mergeFrom === mergeTo) return
    setMerging(true)

    await Promise.all([
      supabase.from('claims').update({ roommate: mergeTo }).eq('roommate', mergeFrom),
      supabase.from('receipts').update({ paid_by: mergeTo }).eq('paid_by', mergeFrom),
      supabase.from('settlements').update({ debtor: mergeTo }).eq('debtor', mergeFrom),
      supabase.from('settlements').update({ creditor: mergeTo }).eq('creditor', mergeFrom),
    ])

    // trips.members is an array — fetch and patch each affected trip
    const { data: trips } = await supabase.from('trips').select('id, members')
    const toUpdate = (trips || []).filter(t => (t.members || []).includes(mergeFrom))
    await Promise.all(
      toUpdate.map(t =>
        supabase.from('trips').update({
          members: t.members.map(m => m === mergeFrom ? mergeTo : m),
        }).eq('id', t.id)
      )
    )

    // If mergeFrom was in the roster, remove it
    if (roster) updateRoster(roster.filter(m => m.name !== mergeFrom))

    setMergeDone(`Merged "${mergeFrom}" into "${mergeTo}"`)
    setMergeFrom('')
    setMergeTo('')
    setMergeConfirm(false)
    setMerging(false)
    loadAllKnownNames()
  }

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
            <div className="relative flex-1" ref={nameInputRef}>
              <input
                type="text"
                value={nameInput}
                onChange={e => { setNameInput(e.target.value); setNameOpen(true) }}
                onClick={() => setNameOpen(true)}
                onKeyDown={e => e.key === 'Enter' && saveName()}
                autoComplete="off"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              />
              {nameOpen && (() => {
                const coreNames = (roster || []).filter(m => m.isCore).map(m => m.name)
                const coreSet = new Set(coreNames.map(n => n.toLowerCase()))
                const otherNames = allKnownNames.filter(n => !coreSet.has(n.toLowerCase()))
                const isExactMatch = [...coreNames, ...otherNames].some(n => n.toLowerCase() === nameInput.toLowerCase())
                const matchCore = coreNames.filter(n => nameInput === '' || isExactMatch || n.toLowerCase().includes(nameInput.toLowerCase()))
                const matchOther = otherNames.filter(n => nameInput === '' || isExactMatch || n.toLowerCase().includes(nameInput.toLowerCase()))
                if (matchCore.length === 0 && matchOther.length === 0) return null
                return (
                  <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                    {matchCore.map(n => (
                      <li key={n}>
                        <button
                          type="button"
                          onMouseDown={e => { e.preventDefault(); setNameInput(n); setNameOpen(false) }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-green-50 hover:text-green-700 transition-colors flex items-center justify-between"
                        >
                          {n}
                          <span className="text-xs text-gray-300">pinned</span>
                        </button>
                      </li>
                    ))}
                    {matchCore.length > 0 && matchOther.length > 0 && (
                      <li className="border-t border-gray-100" />
                    )}
                    {matchOther.map(n => (
                      <li key={n}>
                        <button
                          type="button"
                          onMouseDown={e => { e.preventDefault(); setNameInput(n); setNameOpen(false) }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-green-50 hover:text-green-700 transition-colors"
                        >
                          {n}
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              })()}
            </div>
            <button
              onClick={saveName}
              disabled={!nameInput.trim() || nameInput.trim().replace(/\b\w/g, c => c.toUpperCase()) === currentName}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition disabled:opacity-50"
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
                    className="h-4 w-4 rounded accent-green-600 cursor-pointer"
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
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
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

      {/* Merge people */}
      <section>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-sm font-medium text-gray-700 mb-1">Merge duplicate names</p>
          <p className="text-xs text-gray-400 mb-4">
            If someone's name was entered with a typo, merge all their history under the correct name.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-0">
              <select
                value={mergeFrom}
                onChange={e => { setMergeFrom(e.target.value); setMergeConfirm(false); setMergeDone(null) }}
                className="w-full appearance-none border border-gray-200 rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 bg-white"
              >
                <option value="">Merge this name…</option>
                {allKnownNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            <span className="text-sm text-gray-400 shrink-0">into</span>
            <div className="relative flex-1 min-w-0">
              <select
                value={mergeTo}
                onChange={e => { setMergeTo(e.target.value); setMergeConfirm(false); setMergeDone(null) }}
                className="w-full appearance-none border border-gray-200 rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 bg-white"
              >
                <option value="">…the correct name</option>
                {allKnownNames.filter(n => n !== mergeFrom).map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          {mergeFrom && mergeTo && !mergeConfirm && (
            <button
              onClick={() => setMergeConfirm(true)}
              className="mt-3 w-full py-2 text-sm font-medium border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 transition"
            >
              Merge "{mergeFrom}" → "{mergeTo}"
            </button>
          )}

          {mergeConfirm && (
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm text-amber-800 mb-3">
                This will update all claims, receipts, settlements, and trip memberships. This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={mergeNames}
                  disabled={merging}
                  className="flex-1 py-1.5 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition disabled:opacity-50"
                >
                  {merging ? 'Merging…' : 'Yes, merge'}
                </button>
                <button
                  onClick={() => setMergeConfirm(false)}
                  className="px-4 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition text-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {mergeDone && (
            <p className="mt-3 text-sm text-green-600 font-medium">{mergeDone} ✓</p>
          )}
        </div>
      </section>

      {/* Personal Settings */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-1">Personal settings</h2>
        <p className="text-xs text-gray-400 mb-3">Saved on this device only.</p>
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          <div className="p-4">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-sm font-medium text-gray-800">Show all trips by default</p>
                <p className="text-xs text-gray-400 mt-0.5">When off, only trips you're a member of are shown on the home page</p>
              </div>
              <button
                onClick={() => setDefaultShowAll(v => !v)}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ml-4 ${defaultShowAll ? 'bg-green-500' : 'bg-gray-200'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${defaultShowAll ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </label>
          </div>
          <div className="p-4">
            <p className="text-sm font-medium text-gray-800 mb-0.5">Gemini API key</p>
            <p className="text-xs text-gray-400 mb-2">
              Used to scan receipt photos and auto-fill items. Get a free key at{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-green-500 hover:underline">aistudio.google.com</a>.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={geminiKey}
                onChange={e => { setGeminiKey(e.target.value); setGeminiKeySaved(false) }}
                placeholder="AIza..."
                autoComplete="off"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              />
              <button
                type="button"
                onClick={() => { localStorage.setItem('gemini-api-key', geminiKey.trim()); setGeminiKeySaved(true) }}
                className="px-3 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition"
              >
                {geminiKeySaved ? 'Saved ✓' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
