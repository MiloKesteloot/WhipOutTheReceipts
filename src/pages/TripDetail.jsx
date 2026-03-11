import { Fragment, useEffect, useState, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { calculateDebts, getItemizedBreakdown } from '../lib/splitLogic.js'

export default function TripDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [trip, setTrip] = useState(null)
  const [receipts, setReceipts] = useState([])
  const [items, setItems] = useState([])
  const [meals, setMeals] = useState([])
  const [claims, setClaims] = useState([])
  const [myName, setMyName] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [myClaims, setMyClaims] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [closing, setClosing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedMeals, setExpandedMeals] = useState(new Set())
  const [settlements, setSettlements] = useState([])
  const [settling, setSettling] = useState(false)

  const knownNames = [...new Set([
    ...receipts.map(r => r.paid_by),
    ...claims.map(c => c.roommate),
  ])].filter(Boolean)

  const loadData = useCallback(async () => {
    const [tripRes, receiptsRes, settlementRes] = await Promise.all([
      supabase.from('trips').select('*').eq('id', id).single(),
      supabase.from('receipts').select('*').eq('trip_id', id).order('created_at'),
      supabase.from('settlements').select('*').eq('trip_id', id),
    ])

    if (tripRes.error) { setError('Trip not found.'); setLoading(false); return }
    setTrip(tripRes.data)
    setSettlements(settlementRes.data || [])

    const receiptData = receiptsRes.data || []
    setReceipts(receiptData)

    if (receiptData.length > 0) {
      const receiptIds = receiptData.map(r => r.id)
      const [{ data: itemData }, { data: mealData }] = await Promise.all([
        supabase.from('items').select('*').in('receipt_id', receiptIds).order('created_at'),
        supabase.from('meals').select('*').in('receipt_id', receiptIds).order('created_at'),
      ])
      const allItems = itemData || []
      setItems(allItems)
      setMeals(mealData || [])

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
      setMeals([])
      setClaims([])
    }

    setLoading(false)
  }, [id])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    const saved = localStorage.getItem(`trip-name-${id}`)
    if (saved) {
      setMyName(saved)
      setNameInput(saved)
    }
  }, [id])

  // Sync my claims when name, claims, or items change
  useEffect(() => {
    if (!myName || items.length === 0) return
    const mine = claims.filter(c => c.roommate === myName).map(c => c.item_id)
    const alwaysSplitIds = items.filter(i => i.always_split).map(i => i.id)
    if (mine.length > 0) {
      setMyClaims(new Set([...mine, ...alwaysSplitIds]))
    } else {
      // New user — default everything checked
      setMyClaims(new Set(items.map(i => i.id)))
    }
  }, [myName, claims, items])

  function handleNameSubmit(e) {
    e.preventDefault()
    const name = nameInput.trim()
    if (!name) return
    setMyName(name)
    localStorage.setItem(`trip-name-${id}`, name)
  }

  function toggleClaim(itemId) {
    if (!myName || trip?.closed) return
    const item = items.find(i => i.id === itemId)
    if (item?.always_split) return
    setMyClaims(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
    setSaved(false)
  }

  function toggleMeal(mealId, mealItems) {
    if (!myName || trip?.closed) return
    const toggleableIds = mealItems.filter(i => !i.always_split).map(i => i.id)
    const allChecked = toggleableIds.every(id => myClaims.has(id))
    setMyClaims(prev => {
      const next = new Set(prev)
      if (allChecked) {
        toggleableIds.forEach(id => next.delete(id))
      } else {
        toggleableIds.forEach(id => next.add(id))
      }
      return next
    })
    setSaved(false)
  }

  function getMealCheckState(mealItems) {
    if (mealItems.length === 0) return 'empty'
    const checkedCount = mealItems.filter(i => myClaims.has(i.id)).length
    if (checkedCount === 0) return 'none'
    if (checkedCount === mealItems.length) return 'all'
    return 'some'
  }

  function toggleExpandMeal(mealId) {
    setExpandedMeals(prev => {
      const next = new Set(prev)
      next.has(mealId) ? next.delete(mealId) : next.add(mealId)
      return next
    })
  }

  async function saveClaims() {
    if (!myName) return
    setSaving(true)

    const itemIds = items.map(i => i.id)
    await supabase.from('claims')
      .delete()
      .eq('roommate', myName)
      .in('item_id', itemIds)

    const newClaims = [...myClaims].map(item_id => ({ item_id, roommate: myName }))
    if (newClaims.length > 0) {
      await supabase.from('claims').insert(newClaims)
    }

    await loadData()
    setSaving(false)
    setSaved(true)
  }

  async function markSettled(debtor, creditor) {
    setSettling(true)
    await supabase.from('settlements').upsert(
      { trip_id: id, debtor, creditor },
      { onConflict: 'trip_id,debtor,creditor' }
    )
    await loadData()
    setSettling(false)
  }

  async function unmarkSettled(debtor, creditor) {
    setSettling(true)
    await supabase.from('settlements').delete()
      .eq('trip_id', id).eq('debtor', debtor).eq('creditor', creditor)
    await loadData()
    setSettling(false)
  }

  function isSettled(debtor, creditor) {
    return settlements.some(s => s.debtor === debtor && s.creditor === creditor)
  }

  async function closeTrip() {
    if (!confirm('Mark this trip as closed? It will become read-only.')) return
    setClosing(true)
    await supabase.from('trips').update({ closed: true }).eq('id', id)
    setTrip(t => ({ ...t, closed: true }))
    setClosing(false)
  }

  async function reopenTrip() {
    setClosing(true)
    await supabase.from('trips').update({ closed: false }).eq('id', id)
    setTrip(t => ({ ...t, closed: false }))
    setClosing(false)
  }

  async function deleteTrip() {
    if (!confirm(`Delete "${trip.name}"? This will remove all receipts, items, and claims. This cannot be undone.`)) return
    await supabase.from('trips').delete().eq('id', id)
    navigate('/')
  }

  async function deleteReceipt(receiptId, storeName) {
    if (!confirm(`Delete the ${storeName} receipt? All its items and claims will be removed.`)) return
    await supabase.from('receipts').delete().eq('id', receiptId)
    await loadData()
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Synthetic claims: others' saved claims + my current (unsaved) selections
  // Used for running total so tip/tax is included proportionally
  const syntheticClaims = myName ? [
    ...claims.filter(c => c.roommate !== myName),
    ...[...myClaims].map(item_id => ({ item_id, roommate: myName })),
  ] : claims
  const runningTotal = myName
    ? calculateDebts(receipts, items, syntheticClaims)
        .filter(d => d.debtor === myName)
        .reduce((s, d) => s + d.amount, 0)
    : 0

  const debts = calculateDebts(receipts, items, claims)
  const breakdown = getItemizedBreakdown(receipts, items, claims)

  const claimerNames = new Set(claims.map(c => c.roommate))
  const waitingOn = (trip?.members || []).filter(m => !claimerNames.has(m))

  const itemsByReceipt = {}
  for (const item of items) {
    if (!itemsByReceipt[item.receipt_id]) itemsByReceipt[item.receipt_id] = []
    itemsByReceipt[item.receipt_id].push(item)
  }

  const mealsByReceipt = {}
  for (const meal of meals) {
    if (!mealsByReceipt[meal.receipt_id]) mealsByReceipt[meal.receipt_id] = []
    mealsByReceipt[meal.receipt_id].push(meal)
  }

  if (loading) return <div className="max-w-xl mx-auto p-8 text-gray-400">Loading…</div>
  if (error) return <div className="max-w-xl mx-auto p-8 text-red-500">{error}</div>

  function renderItemRow(item) {
    const itemClaims = claims.filter(c => c.item_id === item.id)
    const claimerList = itemClaims.map(c => c.roommate)
    const isMine = myClaims.has(item.id)
    const locked = item.always_split

    return (
      <li
        key={item.id}
        className={`flex items-center gap-3 px-4 py-3 ${!trip.closed && myName && !locked ? 'cursor-pointer hover:bg-gray-50' : ''}`}
        onClick={() => toggleClaim(item.id)}
      >
        <input
          type="checkbox"
          checked={isMine}
          readOnly
          disabled={!myName || trip.closed || locked}
          className="h-4 w-4 rounded accent-indigo-600 cursor-pointer"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {item.name}
            {locked && <span className="ml-1.5 text-xs text-gray-400" title="Everyone splits this item">🔒</span>}
          </p>
          {claimerList.length > 0 && (
            <p className="text-xs text-gray-400 truncate">{claimerList.join(', ')}</p>
          )}
        </div>
        <span className="text-sm font-medium text-gray-700 shrink-0">
          ${Number(item.price).toFixed(2)}
        </span>
      </li>
    )
  }

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
          <button
            onClick={deleteTrip}
            className="text-sm px-3 py-1.5 border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition"
          >
            Delete
          </button>
          {trip.closed ? (
            <button
              onClick={reopenTrip}
              disabled={closing}
              className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition text-gray-600 disabled:opacity-50"
            >
              Reopen
            </button>
          ) : (
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

      {/* Still waiting on */}
      {waitingOn.length > 0 && items.length > 0 && (
        <div className="mb-4 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
          <span className="shrink-0">Still waiting on:</span>
          <span className="font-medium">{waitingOn.join(', ')}</span>
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
          {receipts.map(receipt => {
            const receiptItems = itemsByReceipt[receipt.id] || []
            const receiptMeals = mealsByReceipt[receipt.id] || []
            const ungroupedItems = receiptItems.filter(i => !i.meal_id)

            return (
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
                    <button
                      onClick={() => deleteReceipt(receipt.id, receipt.store_name)}
                      className="text-xs text-red-400 hover:text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                  <span className="text-xs text-gray-400">paid by {receipt.paid_by}</span>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  {receiptItems.length === 0 ? (
                    <p className="text-gray-400 text-sm px-4 py-3">No items.</p>
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {/* Ungrouped items */}
                      {ungroupedItems.map(item => renderItemRow(item))}

                      {/* Meal groups */}
                      {receiptMeals.map(meal => {
                        const mealItems = receiptItems.filter(i => i.meal_id === meal.id)
                        const expanded = expandedMeals.has(meal.id)
                        const checkState = getMealCheckState(mealItems)
                        const mealTotal = mealItems.reduce((s, i) => s + Number(i.price), 0)
                        const canInteract = myName && !trip.closed

                        return (
                          <Fragment key={meal.id}>
                            {/* Meal header row */}
                            <li
                              className={`flex items-center gap-3 px-4 py-3 bg-gray-50 ${canInteract ? 'cursor-pointer hover:bg-gray-100' : ''}`}
                              onClick={() => toggleMeal(meal.id, mealItems)}
                            >
                              <input
                                type="checkbox"
                                checked={checkState === 'all'}
                                ref={el => { if (el) el.indeterminate = checkState === 'some' }}
                                readOnly
                                disabled={!canInteract}
                                className="h-4 w-4 rounded accent-indigo-600"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-gray-700">{meal.name}</p>
                                <p className="text-xs text-gray-400">{mealItems.length} item{mealItems.length !== 1 ? 's' : ''}</p>
                              </div>
                              <span className="text-sm font-medium text-gray-700 shrink-0">
                                ${mealTotal.toFixed(2)}
                              </span>
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); toggleExpandMeal(meal.id) }}
                                className="text-xs text-gray-400 hover:text-gray-600 px-1 shrink-0"
                              >
                                {expanded ? '▲' : '▼'}
                              </button>
                            </li>

                            {/* Expanded meal items */}
                            {expanded && mealItems.map(item => {
                              const isMine = myClaims.has(item.id)
                              const locked = item.always_split
                              const claimerList = claims.filter(c => c.item_id === item.id).map(c => c.roommate)
                              return (
                                <li
                                  key={item.id}
                                  className={`flex items-center gap-3 pl-10 pr-4 py-2.5 border-t border-gray-100 ${!trip.closed && myName && !locked ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                                  onClick={() => toggleClaim(item.id)}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isMine}
                                    readOnly
                                    disabled={!myName || trip.closed || locked}
                                    className="h-3.5 w-3.5 rounded accent-indigo-600"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-gray-700 truncate">
                                      {item.name}
                                      {locked && <span className="ml-1 text-gray-400">🔒</span>}
                                    </p>
                                    {claimerList.length > 0 && (
                                      <p className="text-xs text-gray-400 truncate">{claimerList.join(', ')}</p>
                                    )}
                                  </div>
                                  <span className="text-xs text-gray-500 shrink-0">${Number(item.price).toFixed(2)}</span>
                                </li>
                              )
                            })}
                          </Fragment>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )
          })}
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

      {/* People who owe you */}
      {myName && items.length > 0 && claims.length > 0 && debts.some(d => d.creditor === myName) && (
        <div className="mt-6 bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="font-semibold text-gray-800 mb-3">People who owe you</h3>
          <ul className="space-y-3">
            {debts.filter(d => d.creditor === myName).map((d, i) => {
              const settled = isSettled(d.debtor, d.creditor)
              const theirItems = (breakdown[d.debtor] || []).filter(e => e.payer === myName)
              return (
                <li key={i}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${settled ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                        {d.debtor}
                      </span>
                      {settled
                        ? <span className="text-xs text-green-600 font-medium">✓ Sent</span>
                        : <span className="text-xs text-amber-500">awaiting</span>
                      }
                    </div>
                    <span className="text-sm font-semibold text-gray-900">${d.amount.toFixed(2)}</span>
                  </div>
                  {theirItems.length > 0 && (
                    <ul className="mt-1 space-y-0.5 pl-1">
                      {theirItems.map((e, j) => (
                        <li key={j} className="flex justify-between text-xs text-gray-400">
                          <span>{e.itemName} <span className="text-gray-300">· {e.storeName}</span></span>
                          <span>${e.share.toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
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
              <ul className="space-y-2">
                {debts.map((d, i) => {
                  const settled = isSettled(d.debtor, d.creditor)
                  return (
                    <li key={i} className="flex items-center justify-between text-sm gap-2">
                      <span className={`text-gray-700 ${settled ? 'line-through text-gray-400' : ''}`}>
                        <strong>{d.debtor}</strong> owes <strong>{d.creditor}</strong>
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-semibold text-gray-900">${d.amount.toFixed(2)}</span>
                        {settled ? (
                          myName === d.debtor ? (
                            <button
                              onClick={() => unmarkSettled(d.debtor, d.creditor)}
                              disabled={settling}
                              className="text-xs text-green-600 font-medium hover:text-gray-400 transition disabled:opacity-50"
                              title="Click to undo"
                            >
                              ✓ Sent
                            </button>
                          ) : (
                            <span className="text-xs text-green-600 font-medium">✓ Sent</span>
                          )
                        ) : (
                          myName === d.debtor ? (
                            <button
                              onClick={() => markSettled(d.debtor, d.creditor)}
                              disabled={settling}
                              className="text-xs px-2 py-0.5 border border-indigo-200 text-indigo-600 rounded-md hover:bg-indigo-50 transition disabled:opacity-50"
                            >
                              Mark sent
                            </button>
                          ) : (
                            <span className="text-xs text-amber-500">awaiting</span>
                          )
                        )}
                      </div>
                    </li>
                  )
                })}
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
