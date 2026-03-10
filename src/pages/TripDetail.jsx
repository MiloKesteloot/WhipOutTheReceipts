import { useEffect, useState, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { calculateDebts, getItemizedBreakdown } from '../lib/splitLogic.js'

export default function TripDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [trip, setTrip] = useState(null)
  const [receipts, setReceipts] = useState([])
  const [items, setItems] = useState([])
  const [claims, setClaims] = useState([]) // all claims for this trip
  const [myName, setMyName] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [myClaims, setMyClaims] = useState(new Set()) // item_ids I've claimed
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [closing, setClosing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Known names in this trip (for autocomplete)
  const knownNames = [...new Set([
    ...receipts.map(r => r.paid_by),
    ...claims.map(c => c.roommate),
  ])].filter(Boolean)

  const loadData = useCallback(async () => {
    const [tripRes, receiptsRes] = await Promise.all([
      supabase.from('trips').select('*').eq('id', id).single(),
      supabase.from('receipts').select('*').eq('trip_id', id).order('created_at'),
    ])

    if (tripRes.error) { setError('Trip not found.'); setLoading(false); return }
    setTrip(tripRes.data)

    const receiptData = receiptsRes.data || []
    setReceipts(receiptData)

    if (receiptData.length > 0) {
      const receiptIds = receiptData.map(r => r.id)
      const { data: itemData } = await supabase
        .from('items').select('*').in('receipt_id', receiptIds).order('created_at')
      const allItems = itemData || []
      setItems(allItems)

      if (allItems.length > 0) {
        const itemIds = allItems.map(i => i.id)
        const { data: claimData } = await supabase
          .from('claims').select('*').in('item_id', itemIds)
        setClaims(claimData || [])
      } else {
        setClaims([])
      }
    } else {
      setItems([])
      setClaims([])
    }

    setLoading(false)
  }, [id])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Restore saved name from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(`trip-name-${id}`)
    if (saved) {
      setMyName(saved)
      setNameInput(saved)
    }
  }, [id])

  // Sync my claims when name or claims change
  useEffect(() => {
    if (!myName) return
    const mine = new Set(claims.filter(c => c.roommate === myName).map(c => c.item_id))
    setMyClaims(mine)
  }, [myName, claims])

  function handleNameSubmit(e) {
    e.preventDefault()
    const name = nameInput.trim()
    if (!name) return
    setMyName(name)
    localStorage.setItem(`trip-name-${id}`, name)
  }

  function toggleClaim(itemId) {
    if (!myName || trip?.closed) return
    setMyClaims(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
    setSaved(false)
  }

  async function saveClaims() {
    if (!myName) return
    setSaving(true)

    // Delete existing claims for this user on items in this trip
    const itemIds = items.map(i => i.id)
    await supabase.from('claims')
      .delete()
      .eq('roommate', myName)
      .in('item_id', itemIds)

    // Insert new claims
    const newClaims = [...myClaims].map(item_id => ({ item_id, roommate: myName }))
    if (newClaims.length > 0) {
      await supabase.from('claims').insert(newClaims)
    }

    // Reload claims
    await loadData()
    setSaving(false)
    setSaved(true)
  }

  async function closeTrip() {
    if (!confirm('Mark this trip as closed? It will become read-only.')) return
    setClosing(true)
    await supabase.from('trips').update({ closed: true }).eq('id', id)
    setTrip(t => ({ ...t, closed: true }))
    setClosing(false)
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const runningTotal = items
    .filter(i => myClaims.has(i.id))
    .reduce((sum, item) => {
      const claimers = claims.filter(c => c.item_id === item.id).map(c => c.roommate)
      // If I just toggled, my name may not be in DB yet — treat myClaims as ground truth
      const effectiveClaimers = new Set(claimers)
      if (myClaims.has(item.id)) effectiveClaimers.add(myName)
      return sum + item.price / effectiveClaimers.size
    }, 0)

  const debts = calculateDebts(receipts, items, claims)
  const breakdown = getItemizedBreakdown(receipts, items, claims)

  // Group items by receipt
  const itemsByReceipt = {}
  for (const item of items) {
    if (!itemsByReceipt[item.receipt_id]) itemsByReceipt[item.receipt_id] = []
    itemsByReceipt[item.receipt_id].push(item)
  }

  if (loading) return <div className="max-w-xl mx-auto p-8 text-gray-400">Loading…</div>
  if (error) return <div className="max-w-xl mx-auto p-8 text-red-500">{error}</div>

  return (
    <div className="max-w-xl mx-auto p-4 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <Link to="/" className="text-sm text-indigo-500 hover:underline mb-1 inline-block">← All trips</Link>
          <h1 className="text-2xl font-bold text-gray-900">{trip.name}</h1>
        </div>
        <div className="flex gap-2 mt-1">
          <button
            onClick={copyLink}
            className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
          >
            {copied ? 'Copied!' : 'Share'}
          </button>
          {!trip.closed && (
            <button
              onClick={closeTrip}
              disabled={closing}
              className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition text-gray-600 disabled:opacity-50"
            >
              Close trip
            </button>
          )}
        </div>
      </div>

      {trip.closed && (
        <span className="inline-block text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full mb-4">
          Closed — read only
        </span>
      )}

      {/* Name prompt */}
      {!myName ? (
        <form onSubmit={handleNameSubmit} className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-6">
          <p className="font-medium text-indigo-900 mb-2">What's your name?</p>
          <input
            list="known-names"
            type="text"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            placeholder="Your name"
            className="w-full border border-indigo-300 rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            autoFocus
          />
          <datalist id="known-names">
            {knownNames.map(n => <option key={n} value={n} />)}
          </datalist>
          <button
            type="submit"
            className="w-full py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition"
          >
            Continue
          </button>
        </form>
      ) : (
        <div className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2 mb-6">
          <span className="text-indigo-800 font-medium">Shopping as: <strong>{myName}</strong></span>
          <button
            onClick={() => { setMyName(''); setNameInput('') }}
            className="text-xs text-indigo-500 hover:underline"
          >
            Change
          </button>
        </div>
      )}

      {/* Add Receipt */}
      {!trip.closed && (
        <Link
          to={`/trip/${id}/add-receipt`}
          className="block w-full text-center py-2.5 mb-6 border-2 border-dashed border-indigo-300 text-indigo-600 font-medium rounded-xl hover:bg-indigo-50 transition"
        >
          + Add Receipt
        </Link>
      )}

      {/* Items */}
      {receipts.length === 0 ? (
        <p className="text-gray-400 text-center py-8">No receipts yet. Add one above!</p>
      ) : (
        <div className="space-y-6 mb-6">
          {receipts.map(receipt => (
            <div key={receipt.id}>
              <div className="flex items-baseline justify-between mb-2">
                <div className="flex items-baseline gap-2">
                  <h2 className="font-semibold text-gray-700">{receipt.store_name}</h2>
                  {!trip.closed && (
                    <Link
                      to={`/trip/${id}/receipt/${receipt.id}/edit`}
                      className="text-xs text-indigo-500 hover:underline"
                    >
                      Edit
                    </Link>
                  )}
                </div>
                <span className="text-xs text-gray-400">paid by {receipt.paid_by}</span>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {(itemsByReceipt[receipt.id] || []).length === 0 ? (
                  <p className="text-gray-400 text-sm px-4 py-3">No items.</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {(itemsByReceipt[receipt.id] || []).map(item => {
                      const itemClaims = claims.filter(c => c.item_id === item.id)
                      const claimerNames = itemClaims.map(c => c.roommate)
                      const isMine = myClaims.has(item.id)

                      return (
                        <li
                          key={item.id}
                          className={`flex items-center gap-3 px-4 py-3 ${!trip.closed && myName ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                          onClick={() => toggleClaim(item.id)}
                        >
                          <input
                            type="checkbox"
                            checked={isMine}
                            readOnly
                            disabled={!myName || trip.closed}
                            className="h-4 w-4 rounded accent-indigo-600 cursor-pointer"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                            {claimerNames.length > 0 && (
                              <p className="text-xs text-gray-400 truncate">
                                {claimerNames.join(', ')}
                              </p>
                            )}
                          </div>
                          <span className="text-sm font-medium text-gray-700 shrink-0">
                            ${Number(item.price).toFixed(2)}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Running total + save */}
      {myName && items.length > 0 && (
        <div className="sticky bottom-4">
          <div className="bg-white border border-gray-200 shadow-lg rounded-2xl px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400">Your running total</p>
              <p className="text-xl font-bold text-indigo-600">${runningTotal.toFixed(2)}</p>
            </div>
            {!trip.closed && (
              <button
                onClick={saveClaims}
                disabled={saving}
                className="px-5 py-2 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition disabled:opacity-50"
              >
                {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save my claims'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Summary */}
      {items.length > 0 && claims.length > 0 && (
        <div className="mt-6 bg-white border border-gray-200 rounded-xl p-4 space-y-4">
          <div>
            <h3 className="font-semibold text-gray-800 mb-2">Who owes what</h3>
            {debts.length === 0 ? (
              <p className="text-gray-400 text-sm">No debts — either everyone paid their own items, or nothing has been claimed.</p>
            ) : (
              <ul className="space-y-1">
                {debts.map((d, i) => (
                  <li key={i} className="flex justify-between text-sm">
                    <span className="text-gray-700">
                      <strong>{d.debtor}</strong> owes <strong>{d.creditor}</strong>
                    </span>
                    <span className="font-semibold text-gray-900">${d.amount.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {Object.keys(breakdown).length > 0 && (
            <div>
              <button
                onClick={() => setShowBreakdown(s => !s)}
                className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700 transition"
              >
                <span>{showBreakdown ? '▲' : '▼'}</span>
                <span>Itemized breakdown</span>
              </button>

              {showBreakdown && (
                <div className="mt-2 space-y-3">
                  {Object.entries(breakdown).map(([person, entries]) => (
                    <div key={person}>
                      <p className="text-sm font-medium text-indigo-700 mb-1">{person}</p>
                      <ul className="space-y-0.5">
                        {entries.map((e, i) => (
                          <li key={i} className="flex justify-between text-xs text-gray-500">
                            <span>{e.itemName} <span className="text-gray-400">({e.storeName}, paid by {e.payer})</span></span>
                            <span>${e.share.toFixed(2)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
