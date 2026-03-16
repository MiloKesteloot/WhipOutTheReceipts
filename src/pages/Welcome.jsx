import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { fetchCoreRoommates } from './Settings.jsx'

export default function Welcome({ onNameSet }) {
  const [name, setName] = useState('')
  const [coreRoommates, setCoreRoommates] = useState([])
  const [otherNames, setOtherNames] = useState([])
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)

  useEffect(() => {
    async function loadNames() {
      const [core, receiptsRes, claimsRes] = await Promise.all([
        fetchCoreRoommates(),
        supabase.from('receipts').select('paid_by'),
        supabase.from('claims').select('roommate'),
      ])
      setCoreRoommates(core)
      const all = new Set([
        ...(receiptsRes.data || []).map(r => r.paid_by),
        ...(claimsRes.data || []).map(c => c.roommate),
      ].filter(Boolean))
      // Other names = known names not in core list
      const coreSet = new Set(core.map(n => n.toLowerCase()))
      setOtherNames([...all].filter(n => !coreSet.has(n.toLowerCase())).sort())
    }
    loadNames()
  }, [])

  useEffect(() => {
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleSubmit(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onNameSet(trimmed)
  }

  const isExactMatch = [...coreRoommates, ...otherNames]
    .some(n => n.toLowerCase() === name.toLowerCase())
  const suggestions = (name === '' || isExactMatch)
    ? [...coreRoommates, ...otherNames]
    : [...coreRoommates, ...otherNames].filter(n =>
        n.toLowerCase().includes(name.toLowerCase())
      )

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Receipts</h1>
          <p className="text-gray-500">Fair grocery splits for roommates.</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800 mb-1">Who are you?</h2>
          <p className="text-sm text-gray-400 mb-4">
            Your name is used to track what you've claimed and what you owe across all trips.
          </p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative" ref={wrapperRef}>
              <input
                type="text"
                value={name}
                onChange={e => { setName(e.target.value); setOpen(true) }}
                onClick={() => setOpen(true)}
                placeholder="Enter your name"
                autoComplete="nickname"
                autoFocus
                className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-400 text-gray-900"
              />
              {open && suggestions.length > 0 && (
                <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                  {coreRoommates.length > 0 && otherNames.length > 0 && (
                    <>
                      {coreRoommates
                        .filter(n => name === '' || isExactMatch || n.toLowerCase().includes(name.toLowerCase()))
                        .map(n => (
                          <li key={n}>
                            <button
                              type="button"
                              onMouseDown={e => { e.preventDefault(); setName(n); setOpen(false) }}
                              className="w-full text-left px-4 py-2.5 text-sm hover:bg-green-50 hover:text-green-700 transition-colors flex items-center justify-between"
                            >
                              {n}
                              <span className="text-xs text-gray-300">pinned</span>
                            </button>
                          </li>
                        ))}
                      {otherNames
                        .filter(n => name === '' || isExactMatch || n.toLowerCase().includes(name.toLowerCase()))
                        .length > 0 && (
                        <li className="border-t border-gray-100" />
                      )}
                      {otherNames
                        .filter(n => name === '' || isExactMatch || n.toLowerCase().includes(name.toLowerCase()))
                        .map(n => (
                          <li key={n}>
                            <button
                              type="button"
                              onMouseDown={e => { e.preventDefault(); setName(n); setOpen(false) }}
                              className="w-full text-left px-4 py-2.5 text-sm hover:bg-green-50 hover:text-green-700 transition-colors"
                            >
                              {n}
                            </button>
                          </li>
                        ))}
                    </>
                  )}
                  {/* If only one group exists, render flat */}
                  {(coreRoommates.length === 0 || otherNames.length === 0) && suggestions.map(n => (
                    <li key={n}>
                      <button
                        type="button"
                        onMouseDown={e => { e.preventDefault(); setName(n); setOpen(false) }}
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-green-50 hover:text-green-700 transition-colors"
                      >
                        {n}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="submit"
              disabled={!name.trim()}
              className="w-full py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition disabled:opacity-50"
            >
              Get started →
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
