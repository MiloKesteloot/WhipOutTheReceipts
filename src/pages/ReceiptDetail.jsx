import { Fragment, useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { calculateDebts, getItemizedBreakdown } from '../lib/splitLogic.js'
import { getItemEmoji } from '../lib/itemEmoji.js'
import { useDialog } from '../lib/useDialog.jsx'
import { CATEGORIES, STORE_DOMAINS } from '../config.js'
import { useGroup, formatWaitingOn } from '../lib/group.jsx'
import { receiptFromDb, claimFromDb, checkinFromDb, syncMyClaims, ensureCheckin, recordPayment, deletePayment } from '../lib/db.js'
import { useBalances } from '../lib/useBalances.js'
import ReceiptHistory from '../components/ReceiptHistory.jsx'
import BackButton from '../components/BackButton.jsx'

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
  const { group, switchGroup, myName, myMember, nameOf, idOf } = useGroup()
  const [myClaims, setMyClaims] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedMeals, setExpandedMeals] = useState(new Set())
  const [settling, setSettling] = useState(false)
  const [checkins, setCheckins] = useState([])
  const [isDirty, setIsDirty] = useState(false)
  const claimsLoadedRef = useRef(false)
  const { confirm, showAlert, DialogUI } = useDialog()
  const bal = useBalances()

  const loadData = useCallback(async () => {
    const [receiptRes, checkinRes] = await Promise.all([
      supabase.from('receipts').select('*').eq('id', receiptId).single(),
      supabase.from('checkins').select('*').eq('receipt_id', receiptId),
    ])

    if (receiptRes.error) { setError('Receipt not found.'); setLoading(false); return }
    // Shared link to a receipt in another of my groups: switch to that group
    if (receiptRes.data.group_id !== group.id) { switchGroup(receiptRes.data.group_id); return }
    setReceipt(receiptFromDb(receiptRes.data, nameOf))
    setCheckins((checkinRes.data || []).map(x => checkinFromDb(x, nameOf)))

    const [{ data: itemData }, { data: mealData }] = await Promise.all([
      supabase.from('items').select('*').eq('receipt_id', receiptId).is('deleted_at', null)
        .order('position', { ascending: true, nullsFirst: false }).order('created_at'),
      supabase.from('meals').select('*').eq('receipt_id', receiptId).is('deleted_at', null).order('created_at'),
    ])
    const allItems = itemData || []
    setItems(allItems)
    setMeals(mealData || [])

    if (allItems.length > 0) {
      const { data: claimData } = await supabase
        .from('claims').select('*').in('item_id', allItems.map(i => i.id))
      setClaims((claimData || []).map(c => claimFromDb(c, nameOf)))
    } else {
      setClaims([])
    }

    setLoading(false)
  }, [receiptId, nameOf, group.id])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (!myName || items.length === 0) return
    const mine = claims.filter(c => c.roommate === myName).map(c => c.item_id)
    const alwaysSplitIds = items.filter(i => i.always_split).map(i => i.id)
    // Checked in before (on any device: the check-in is in the database) →
    // show exactly what I claimed. Only a first visit starts with everything checked.
    const checkedIn = checkins.some(c => c.member_id === myMember?.id)
    const hasEverSaved = checkedIn || !!localStorage.getItem(`claimed-receipt-${receiptId}-${myMember?.id}`)
    if (mine.length > 0 || hasEverSaved) {
      setMyClaims(new Set([...mine, ...alwaysSplitIds]))
    } else {
      setMyClaims(new Set(items.map(i => i.id)))
    }
    claimsLoadedRef.current = true
    setIsDirty(false)
  }, [myName, claims, items, checkins, receiptId])

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
    const currentMine = new Set(claims.filter(c => c.roommate === myName).map(c => c.item_id))
    try {
      await syncMyClaims(myMember.id, itemIds, currentMine, myClaims)
      await ensureCheckin(myMember.id, receiptId)
      // Checking things off a receipt puts you on it (when it has a member list)
      const memberIds = receipt.member_ids || []
      if (memberIds.length && !memberIds.includes(myMember.id) && myClaims.size > 0) {
        const nextIds = [...memberIds, myMember.id]
        const { error } = await supabase.from('receipts').update({ member_ids: nextIds }).eq('id', receiptId)
        if (error) throw error
        setReceipt(r => ({ ...r, member_ids: nextIds, members: nextIds.map(nameOf) }))
      }
      bal.reload()
    } catch (err) {
      setSaving(false)
      await showAlert(err.message, { title: 'Could not save claims' })
      return
    }
    const newClaims = [...myClaims].map(item_id => ({ item_id, member_id: myMember.id, roommate: myName }))

    localStorage.setItem(`claimed-receipt-${receiptId}-${myMember.id}`, '1')
    setClaims(prev => [
      ...prev.filter(c => !(c.roommate === myName && itemIds.includes(c.item_id))),
      ...newClaims,
    ])
    setCheckins(prev => [
      ...prev.filter(c => c.roommate !== myName),
      { receipt_id: receiptId, member_id: myMember.id, roommate: myName },
    ])
    setSaving(false)
    setSaved(true)
    setIsDirty(false)
  }

  // How much of one debt on this receipt is still unpaid. Once everyone has
  // checked in, this comes from the group-wide balances (payments apply to
  // this receipt if they named it, otherwise oldest receipts first); before
  // that, only payments made for this receipt count.
  function debtState(d) {
    const linked = (bal.data?.payments || [])
      .filter(p => p.receiptId === receiptId && p.from === d.debtor && p.to === d.creditor)
    let remaining = receiptComplete && bal.balances
      ? bal.balances.remainingFor(receiptId, d.debtor, d.creditor)
      : Math.max(0, d.amount - linked.reduce((sum, p) => sum + Number(p.amount), 0))
    remaining = Math.round(remaining * 100) / 100
    const status = remaining <= 0.005 ? 'full' : remaining < d.amount - 0.005 ? 'partial' : 'none'
    return { status, remaining, linked }
  }

  async function markSent(d, amount) {
    setSettling(true)
    try {
      await recordPayment({ groupId: group.id, fromId: idOf(d.debtor), toId: idOf(d.creditor), amount, receiptId })
      await bal.reload()
    } catch (err) {
      await showAlert(err.message, { title: 'Could not save payment' })
    }
    setSettling(false)
  }

  // Undo: remove the most recent payment made for this receipt
  async function undoSent(linked) {
    const last = [...linked].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]
    if (!last) return
    setSettling(true)
    try {
      await deletePayment(last.id)
      await bal.reload()
    } catch (err) {
      await showAlert(err.message, { title: 'Could not undo' })
    }
    setSettling(false)
  }

  async function handleBack() {
    if (isDirty && !await confirm('You have unsaved claims. Leave without saving?', {
      title: 'Unsaved changes', confirmLabel: 'Leave', danger: true,
    })) return
    navigate('/')
  }

  async function deleteReceipt() {
    if (!await confirm('It will be hidden for everyone. You can restore it later from this page, and the change is recorded in its history.', {
      title: 'Delete receipt?', confirmLabel: 'Delete', danger: true,
    })) return
    const { error } = await supabase.from('receipts').update({ deleted_at: new Date().toISOString() }).eq('id', receiptId)
    if (error) { await showAlert(error.message, { title: 'Could not delete' }); return }
    navigate('/')
  }

  async function restoreReceipt() {
    const { error } = await supabase.from('receipts').update({ deleted_at: null }).eq('id', receiptId)
    if (error) { await showAlert(error.message, { title: 'Could not restore' }); return }
    setReceipt(r => ({ ...r, deleted_at: null }))
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const countedClaims = claims
  const syntheticClaims = myName ? [
    ...countedClaims.filter(c => c.roommate !== myName),
    ...[...myClaims].map(item_id => ({ item_id, roommate: myName })),
  ] : countedClaims
  const receiptArr = receipt ? [receipt] : []
  const runningTotal = myName
    ? calculateDebts(receiptArr, items, syntheticClaims, meals)
        .filter(d => d.debtor === myName)
        .reduce((s, d) => s + d.amount, 0)
    : 0
  const debts = calculateDebts(receiptArr, items, countedClaims, meals)
  const breakdown = getItemizedBreakdown(receiptArr, items, countedClaims, meals)

  const checkinNames = new Set(checkins.map(c => c.roommate.toLowerCase()))
  const claimerNames = new Set(claims.map(c => c.roommate.toLowerCase()))
  const receiptComplete = (receipt?.members || []).every(m => checkinNames.has(m.toLowerCase()))
  const receiptMembers = (() => {
    const base = receipt?.members || []
    const payer = receipt?.paid_by
    if (!payer || base.some(m => m.toLowerCase() === payer.toLowerCase())) return base
    return [...base, payer]
  })()
  const waitingOn = receiptMembers.filter(
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
          <BackButton onClick={handleBack} className="mb-2" />
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

      {receipt.deleted_at && (
        <div className="mt-3 flex items-center justify-between gap-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
          <span>This receipt was deleted on {new Date(receipt.deleted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.</span>
          <button onClick={restoreReceipt} className="shrink-0 px-3 py-1 text-xs font-medium bg-white border border-red-200 rounded-lg hover:bg-red-100 transition">Restore</button>
        </div>
      )}

      {/* Members */}
      <div className="mt-3 mb-4">
        <span className="text-sm text-gray-500">Members: {(receipt.members || []).join(', ') || 'none'}</span>
      </div>

      {/* Waiting on */}
      {waitingOn.length > 0 && items.length > 0 && (
        <div className="mb-4 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
          <span className="shrink-0">Still waiting on:</span>
          <span className="font-medium">{formatWaitingOn(waitingOn, myName)}</span>
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
        <div className="sticky bottom-above-tabbar sm:bottom-4">
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
              const ss = debtState(d)
              const theirItems = (breakdown[d.debtor] || []).filter(e => e.payer === myName)
              return (
                <li key={i}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${ss.status === 'full' ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                        {d.debtor}
                      </span>
                      {ss.status === 'full'
                        ? <span className="text-xs text-accent-600 font-medium">✓ Sent</span>
                        : ss.status === 'partial'
                          ? <span className="text-xs text-amber-500">partial</span>
                          : <span className="text-xs text-amber-500">awaiting</span>}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-900">${d.amount.toFixed(2)}</p>
                      {ss.status === 'partial' && (
                        <p className="text-xs text-gray-400">${ss.remaining.toFixed(2)} still owed</p>
                      )}
                    </div>
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
            {!receiptComplete && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3">
                Not final yet: these amounts count toward balances once everyone on the receipt has checked in.
              </p>
            )}
            {debts.length === 0 ? (
              <p className="text-gray-400 text-sm">No debts — everyone paid their own items or nothing has been claimed.</p>
            ) : (
              <ul className="space-y-2">
                {debts.map((d, i) => {
                  const st = debtState(d)
                  const settled = st.status === 'full'
                  return (
                    <li key={i} className="flex items-center justify-between text-sm gap-2">
                      <span className={`text-gray-700 ${settled ? 'line-through text-gray-400' : ''}`}>
                        <strong>{d.debtor}</strong> owes <strong>{d.creditor}</strong>
                        {st.status === 'partial' && <span className="text-xs text-amber-600 ml-1.5">${st.remaining.toFixed(2)} left</span>}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-semibold text-gray-900">${d.amount.toFixed(2)}</span>
                        {settled ? (
                          myName === d.debtor && st.linked.length > 0 ? (
                            <button onClick={() => undoSent(st.linked)} disabled={settling}
                              className="text-xs text-accent-600 font-medium hover:text-gray-400 transition disabled:opacity-50" title="Undo your payment for this receipt">
                              ✓ Sent
                            </button>
                          ) : <span className="text-xs text-accent-600 font-medium">✓ Paid</span>
                        ) : myName === d.debtor ? (
                          <button onClick={() => markSent(d, st.remaining)} disabled={settling}
                            className="text-xs px-2 py-0.5 border border-accent-200 text-accent-600 rounded-md hover:bg-accent-50 transition disabled:opacity-50">
                            Mark sent
                          </button>
                        ) : myName === d.creditor ? (
                          <button onClick={() => markSent(d, st.remaining)} disabled={settling}
                            className="text-xs px-2 py-0.5 border border-gray-200 text-gray-500 rounded-md hover:bg-gray-50 transition disabled:opacity-50">
                            Mark received
                          </button>
                        ) : <span className="text-xs text-amber-500">awaiting</span>}
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

      <ReceiptHistory receiptId={receiptId} key={`${saved}-${receipt.deleted_at}-${bal.data?.payments?.length}`} />
    </div>
    </>
  )
}
