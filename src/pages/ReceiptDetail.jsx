import { Fragment, useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { calculateDebts, getItemizedBreakdown } from '../lib/splitLogic.js'
import { getItemEmoji } from '../lib/itemEmoji.js'
import { useDialog } from '../lib/useDialog.jsx'
import { CATEGORIES, STORE_DOMAINS } from '../config.js'
import { fetchCoreRoommates } from './Settings.jsx'

function getStoreLogo(storeName) {
  if (!storeName) return null
  const lower = storeName.toLowerCase()
  const match = STORE_DOMAINS.find(({ keywords }) => keywords.some(k => lower.includes(k)))
  if (!match) return null
  return `https://www.google.com/s2/favicons?domain=${match.domain}&sz=32`
}

export default function ReceiptDetail() {
  const { receiptId } = useParams()
  const navigate = useNavigate()

  const [receipt, setReceipt] = useState(null)
  const [items, setItems] = useState([])
  const [meals, setMeals] = useState([])
  const [claims, setClaims] = useState([])
  const myName = localStorage.getItem('global-name') || ''
  const [myClaims, setMyClaims] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedMeals, setExpandedMeals] = useState(new Set())
  const [settlements, setSettlements] = useState([])
  const [settling, setSettling] = useState(false)
  const [checkins, setCheckins] = useState([])
  const [isDirty, setIsDirty] = useState(false)
  const [editingMembers, setEditingMembers] = useState(false)
  const [membersEdit, setMembersEdit] = useState([])
  const [memberInput, setMemberInput] = useState('')
  const [coreRoommates, setCoreRoommates] = useState([])
  const claimsLoadedRef = useRef(false)
  const { confirm, DialogUI } = useDialog()

  const loadData = useCallback(async () => {
    const [receiptRes, settlementRes, checkinRes] = await Promise.all([
      supabase.from('receipts').select('*').eq('id', receiptId).single(),
      supabase.from('settlements').select('*').eq('receipt_id', receiptId),
      supabase.from('checkins').select('*').eq('receipt_id', receiptId),
    ])

    if (receiptRes.error) { setError('Receipt not found.'); setLoading(false); return }
    setReceipt(receiptRes.data)
    setSettlements(settlementRes.data || [])
    setCheckins(checkinRes.data || [])

    const [{ data: itemData }, { data: mealData }] = await Promise.all([
      supabase.from('items').select('*').eq('receipt_id', receiptId).order('created_at'),
      supabase.from('meals').select('*').eq('receipt_id', receiptId).order('created_at'),
    ])
    const allItems = itemData || []
    setItems(allItems)
    setMeals(mealData || [])

    if (allItems.length > 0) {
      const { data: claimData } = await supabase
        .from('claims').select('*').in('item_id', allItems.map(i => i.id))
      setClaims(claimData || [])
    } else {
      setClaims([])
    }

    setLoading(false)
  }, [receiptId])

  useEffect(() => {
    loadData()
    fetchCoreRoommates().then(setCoreRoommates)
  }, [loadData])

  useEffect(() => {
    if (!myName || items.length === 0) return
    const mine = claims.filter(c => c.roommate === myName).map(c => c.item_id)
    const alwaysSplitIds = items.filter(i => i.always_split).map(i => i.id)
    const hasEverSaved = !!localStorage.getItem(`claimed-receipt-${receiptId}-${myName}`)
    if (mine.length > 0 || hasEverSaved) {
      setMyClaims(new Set([...mine, ...alwaysSplitIds]))
    } else {
      setMyClaims(new Set(items.map(i => i.id)))
    }
    claimsLoadedRef.current = true
    setIsDirty(false)
  }, [myName, claims, items, receiptId])

  function toggleClaim(itemId) {
    if (!myName) return
    const item = items.find(i => i.id === itemId)
    if (item?.always_split) return
    setMyClaims(prev => {
      const next = new Set(prev)
      next.has(itemId) ? next.delete(itemId) : next.add(itemId)
      return next
    })
    setSaved(false)
    if (claimsLoadedRef.current) setIsDirty(true)
  }

  function toggleMealGroup(mealId, mealItems) {
    if (!myName) return
    const toggleableIds = mealItems.filter(i => !i.always_split).map(i => i.id)
    const allChecked = toggleableIds.every(id => myClaims.has(id))
    setMyClaims(prev => {
      const next = new Set(prev)
      if (allChecked) toggleableIds.forEach(id => next.delete(id))
      else toggleableIds.forEach(id => next.add(id))
      return next
    })
    setSaved(false)
    if (claimsLoadedRef.current) setIsDirty(true)
  }

  function getMealCheckState(mealItems) {
    if (mealItems.length === 0) return 'empty'
    const n = mealItems.filter(i => myClaims.has(i.id)).length
    if (n === 0) return 'none'
    if (n === mealItems.length) return 'all'
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
    await supabase.from('claims').delete().eq('roommate', myName).in('item_id', itemIds)
    const newClaims = [...myClaims].map(item_id => ({ item_id, roommate: myName }))
    if (newClaims.length > 0) await supabase.from('claims').insert(newClaims)

    // delete+insert for checkin (avoids upsert constraint issues with partial indexes)
    await supabase.from('checkins').delete().eq('receipt_id', receiptId).eq('roommate', myName)
    await supabase.from('checkins').insert({ receipt_id: receiptId, roommate: myName })

    localStorage.setItem(`claimed-receipt-${receiptId}-${myName}`, '1')
    setClaims(prev => [
      ...prev.filter(c => !(c.roommate === myName && itemIds.includes(c.item_id))),
      ...newClaims,
    ])
    setCheckins(prev => [
      ...prev.filter(c => c.roommate !== myName),
      { receipt_id: receiptId, roommate: myName },
    ])
    setSaving(false)
    setSaved(true)
    setIsDirty(false)
  }

  async function markSettled(debtor, creditor) {
    setSettling(true)
    await supabase.from('settlements').delete()
      .eq('receipt_id', receiptId).eq('debtor', debtor).eq('creditor', creditor)
    await supabase.from('settlements').insert({ receipt_id: receiptId, debtor, creditor })
    setSettlements(prev => [
      ...prev.filter(s => !(s.debtor === debtor && s.creditor === creditor)),
      { receipt_id: receiptId, debtor, creditor },
    ])
    setSettling(false)
  }

  async function unmarkSettled(debtor, creditor) {
    setSettling(true)
    await supabase.from('settlements').delete()
      .eq('receipt_id', receiptId).eq('debtor', debtor).eq('creditor', creditor)
    setSettlements(prev => prev.filter(s => !(s.debtor === debtor && s.creditor === creditor)))
    setSettling(false)
  }

  function isSettled(debtor, creditor) {
    return settlements.some(
      s => s.debtor.toLowerCase() === debtor.toLowerCase()
        && s.creditor.toLowerCase() === creditor.toLowerCase()
    )
  }

  async function handleBack() {
    if (isDirty && !await confirm('You have unsaved claims. Leave without saving?', {
      title: 'Unsaved changes', confirmLabel: 'Leave', danger: true,
    })) return
    navigate('/')
  }

  async function deleteReceipt() {
    if (!await confirm('All items and claims will be permanently removed.', {
      title: 'Delete receipt?', confirmLabel: 'Delete', danger: true,
    })) return
    await supabase.from('receipts').delete().eq('id', receiptId)
    navigate('/')
  }

  async function saveMembers(newMembers) {
    await supabase.from('receipts').update({ members: newMembers }).eq('id', receiptId)
    setReceipt(r => ({ ...r, members: newMembers }))
    setEditingMembers(false)
    setMemberInput('')
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const syntheticClaims = myName ? [
    ...claims.filter(c => c.roommate !== myName),
    ...[...myClaims].map(item_id => ({ item_id, roommate: myName })),
  ] : claims
  const receiptArr = receipt ? [receipt] : []
  const runningTotal = myName
    ? calculateDebts(receiptArr, items, syntheticClaims, meals)
        .filter(d => d.debtor === myName)
        .reduce((s, d) => s + d.amount, 0)
    : 0
  const debts = calculateDebts(receiptArr, items, claims, meals)
  const breakdown = getItemizedBreakdown(receiptArr, items, claims, meals)

  const checkinNames = new Set(checkins.map(c => c.roommate.toLowerCase()))
  const claimerNames = new Set(claims.map(c => c.roommate.toLowerCase()))
  const waitingOn = (receipt?.members || []).filter(
    m => !checkinNames.has(m.toLowerCase()) && !claimerNames.has(m.toLowerCase())
  )

  const itemsByMeal = {}
  for (const item of items) {
    if (item.meal_id) {
      if (!itemsByMeal[item.meal_id]) itemsByMeal[item.meal_id] = []
      itemsByMeal[item.meal_id].push(item)
    }
  }
  const ungroupedItems = items.filter(i => !i.meal_id)

  if (loading) return <div className="max-w-xl mx-auto p-8 text-gray-400">Loading…</div>
  if (error) return <div className="max-w-xl mx-auto p-8 text-red-500">{error}</div>

  function renderItemRow(item, indent = false) {
    const claimerList = claims.filter(c => c.item_id === item.id).map(c => c.roommate)
    const isMine = myClaims.has(item.id)
    const locked = item.always_split
    return (
      <li
        key={item.id}
        className={`flex items-center gap-3 ${indent ? 'pl-10 pr-4 py-2.5' : 'px-4 py-3'} ${myName && !locked ? 'cursor-pointer hover:bg-gray-50' : ''}`}
        onClick={() => toggleClaim(item.id)}
      >
        <input
          type="checkbox"
          checked={isMine}
          readOnly
          disabled={!myName || locked}
          className={`${indent ? 'h-3.5 w-3.5' : 'h-4 w-4'} rounded accent-accent-600`}
        />
        <div className="flex-1 min-w-0">
          <p className={`${indent ? 'text-xs' : 'text-sm'} font-medium text-gray-900 truncate`}>
            {item.name}
            {getItemEmoji(item.name) && <span className="ml-1.5">{getItemEmoji(item.name)}</span>}
            {locked && <span className="ml-1.5 text-xs text-gray-400">🔒</span>}
          </p>
          {claimerList.length > 0 && (
            <p className="text-xs text-gray-400 truncate">{claimerList.join(', ')}</p>
          )}
        </div>
        <span className={`${indent ? 'text-xs text-gray-500' : 'text-sm font-medium text-gray-700'} shrink-0`}>
          ${Number(item.price).toFixed(2)}
        </span>
      </li>
    )
  }

  return (
    <>
    {DialogUI}
    <div className="max-w-xl mx-auto p-4 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div className="min-w-0 flex-1 mr-3">
          <button
            onClick={handleBack}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 hover:bg-gray-50 px-2.5 py-1 rounded-lg transition mb-2"
          >
            ← Back
          </button>
          <div className="flex items-center gap-2 flex-wrap">
            {getStoreLogo(receipt.store_name) && (
              <img src={getStoreLogo(receipt.store_name)} alt="" className="w-6 h-6 rounded" />
            )}
            <h1 className="text-2xl font-bold text-gray-900">{receipt.store_name}</h1>
            {receipt.category && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                CATEGORIES.find(c => c.label === receipt.category)?.color || 'bg-gray-100 text-gray-600'
              }`}>
                {receipt.category}
              </span>
            )}
          </div>
          {receipt.receipt_date && (
            <p className="text-sm text-gray-400 mt-0.5">
              {new Date(receipt.receipt_date + 'T12:00:00').toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric',
              })}
            </p>
          )}
          <p className="text-sm text-gray-500 mt-0.5">Paid by {receipt.paid_by}</p>
        </div>
        <div className="flex gap-1.5 mt-1 shrink-0">
          <button
            onClick={copyLink}
            className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition text-gray-500"
            title={copied ? 'Copied!' : 'Copy share link'}
          >
            {copied ? (
              <svg className="h-4 w-4 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            )}
          </button>
          <button
            onClick={() => navigate(`/receipt/${receiptId}/edit`)}
            className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition text-gray-400 hover:text-gray-600"
            title="Edit receipt"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          <button
            onClick={deleteReceipt}
            className="p-2 border border-gray-200 rounded-lg hover:bg-red-50 hover:border-red-200 transition text-gray-400 hover:text-red-400"
            title="Delete receipt"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Members */}
      <div className="mt-3 mb-4">
        {editingMembers ? (
          <div className="bg-white border border-gray-200 rounded-xl p-3">
            <p className="text-sm font-medium text-gray-700 mb-2">Who's on this receipt?</p>
            <div className="flex flex-wrap gap-2 mb-2">
              {[...new Set([...coreRoommates, ...(receipt.members || [])])].map(name => {
                const selected = membersEdit.includes(name)
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setMembersEdit(prev =>
                      prev.includes(name) ? prev.filter(m => m !== name) : [...prev, name]
                    )}
                    className={`px-3 py-1 rounded-full text-sm font-medium border transition ${
                      selected ? 'bg-accent-600 text-white border-accent-600' : 'bg-white text-gray-500 border-gray-300 hover:border-accent-400'
                    }`}
                  >
                    {name}
                  </button>
                )
              })}
            </div>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={memberInput}
                onChange={e => setMemberInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    const name = memberInput.trim()
                    if (name && !membersEdit.includes(name)) setMembersEdit(prev => [...prev, name])
                    setMemberInput('')
                  }
                }}
                placeholder="Add someone…"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => saveMembers(membersEdit)}
                className="px-4 py-1.5 bg-accent-600 text-white text-sm font-medium rounded-lg hover:bg-accent-700 transition"
              >
                Save
              </button>
              <button
                onClick={() => { setEditingMembers(false); setMemberInput('') }}
                className="px-4 py-1.5 text-gray-600 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <span className="text-sm text-gray-500">Members: {(receipt.members || []).join(', ') || 'none'}</span>
        )}
      </div>

      {/* Waiting on */}
      {waitingOn.length > 0 && items.length > 0 && (
        <div className="mb-4 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
          <span className="shrink-0">Still waiting on:</span>
          <span className="font-medium">{waitingOn.join(', ')}</span>
        </div>
      )}

      {/* Items */}
      {items.length === 0 ? (
        <div className="py-8 flex flex-col items-center">
          <button
            onClick={() => navigate(`/receipt/${receiptId}/edit`)}
            className="flex flex-col items-center gap-3 w-full max-w-xs p-8 border-2 border-dashed border-gray-200 rounded-2xl text-gray-400 hover:border-accent-300 hover:text-accent-500 hover:bg-accent-50 transition-all"
          >
            <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-base font-medium">Add items</span>
          </button>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
          <ul className="divide-y divide-gray-100">
            {ungroupedItems.map(item => renderItemRow(item))}
            {meals.map(meal => {
              const mealItems = itemsByMeal[meal.id] || []
              const expanded = expandedMeals.has(meal.id)
              const checkState = getMealCheckState(mealItems)
              const mealTotal = mealItems.reduce((s, i) => s + Number(i.price), 0)
              return (
                <Fragment key={meal.id}>
                  <li
                    className={`flex items-center gap-3 px-4 py-3 bg-gray-50 ${myName ? 'cursor-pointer hover:bg-gray-100' : ''}`}
                    onClick={() => toggleMealGroup(meal.id, mealItems)}
                  >
                    <input
                      type="checkbox"
                      checked={checkState === 'all'}
                      ref={el => { if (el) el.indeterminate = checkState === 'some' }}
                      readOnly
                      disabled={!myName}
                      className="h-4 w-4 rounded accent-accent-600"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-700">{meal.name}</p>
                      <p className="text-xs text-gray-400">{mealItems.length} item{mealItems.length !== 1 ? 's' : ''}</p>
                    </div>
                    <span className="text-sm font-medium text-gray-700 shrink-0">${mealTotal.toFixed(2)}</span>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); toggleExpandMeal(meal.id) }}
                      className="text-gray-400 hover:text-gray-600 px-1 shrink-0"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={expanded ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
                      </svg>
                    </button>
                  </li>
                  {expanded && mealItems.map(item => renderItemRow(item, true))}
                </Fragment>
              )
            })}
            {(() => {
              const t = Number(receipt.tax) || 0
              const ti = Number(receipt.tip) || 0
              const f = Number(receipt.fees) || 0
              const parts = []
              if (t) parts.push(`Tax $${t.toFixed(2)}`)
              if (ti) parts.push(`Tip $${ti.toFixed(2)}`)
              if (f) parts.push(`Service fee $${f.toFixed(2)}`)
              if (parts.length === 0) return null
              return (
                <li className="flex items-center gap-3 px-4 py-3 bg-gray-50/60">
                  <input type="checkbox" checked readOnly disabled className="h-4 w-4 rounded accent-accent-600 opacity-40" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-400 truncate">
                      {parts.join(' · ')}
                      <span className="ml-1.5 text-xs">🔒</span>
                    </p>
                    <p className="text-xs text-gray-300">Distributed proportionally to what you bought</p>
                  </div>
                  <span className="text-sm font-medium text-gray-400 shrink-0">${(t + ti + f).toFixed(2)}</span>
                </li>
              )
            })()}
          </ul>
        </div>
      )}

      {/* Running total + save */}
      {myName && items.length > 0 && (
        <div className="sticky bottom-4">
          <div className="bg-white border border-gray-200 shadow-lg rounded-2xl px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400">Your running total</p>
              <p className="text-xl font-bold text-accent-600">${runningTotal.toFixed(2)}</p>
            </div>
            <button
              onClick={saveClaims}
              disabled={saving}
              className="px-5 py-2 bg-accent-600 text-white font-semibold rounded-xl hover:bg-accent-700 transition disabled:opacity-50 min-w-[140px] whitespace-nowrap text-center"
            >
              {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save my claims'}
            </button>
          </div>
        </div>
      )}

      {/* People who owe you */}
      {myName && items.length > 0 && debts.some(d => d.creditor === myName) && (
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
                        ? <span className="text-xs text-accent-600 font-medium">✓ Sent</span>
                        : <span className="text-xs text-amber-500">awaiting</span>}
                    </div>
                    <span className="text-sm font-semibold text-gray-900">${d.amount.toFixed(2)}</span>
                  </div>
                  {theirItems.length > 0 && (
                    <ul className="mt-1 space-y-0.5 pl-1">
                      {theirItems.map((e, j) => (
                        <li key={j} className="flex justify-between text-xs text-gray-400">
                          <span>{e.itemName}</span>
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

      {/* Who owes what */}
      {items.length > 0 && claims.length > 0 && (
        <div className="mt-6 bg-white border border-gray-200 rounded-xl p-4 space-y-4">
          <div>
            <h3 className="font-semibold text-gray-800 mb-2">Who owes what</h3>
            {debts.length === 0 ? (
              <p className="text-gray-400 text-sm">No debts — everyone paid their own items or nothing has been claimed.</p>
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
                            <button onClick={() => unmarkSettled(d.debtor, d.creditor)} disabled={settling}
                              className="text-xs text-accent-600 font-medium hover:text-gray-400 transition disabled:opacity-50" title="Click to undo">
                              ✓ Sent
                            </button>
                          ) : <span className="text-xs text-accent-600 font-medium">✓ Sent</span>
                        ) : (
                          myName === d.debtor ? (
                            <button onClick={() => markSettled(d.debtor, d.creditor)} disabled={settling}
                              className="text-xs px-2 py-0.5 border border-accent-200 text-accent-600 rounded-md hover:bg-accent-50 transition disabled:opacity-50">
                              Mark sent
                            </button>
                          ) : <span className="text-xs text-amber-500">awaiting</span>
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
                className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 transition"
              >
                <span>Itemized breakdown</span>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={showBreakdown ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
                </svg>
              </button>
              {showBreakdown && (
                <div className="mt-2 space-y-3">
                  {Object.entries(breakdown).map(([person, entries]) => (
                    <div key={person}>
                      <p className="text-sm font-medium text-accent-700 mb-1">{person}</p>
                      <ul className="space-y-0.5">
                        {entries.map((e, i) => (
                          <li key={i} className="flex justify-between text-xs text-gray-500">
                            <span>{e.itemName}</span>
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
    </>
  )
}
