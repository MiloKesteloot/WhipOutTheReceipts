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
import { guestLinkUrl } from './GroupSettings.jsx'
import BackButton from '../components/BackButton.jsx'
import { copyText } from '../lib/clipboard.js'
import { useGoBack, canGoBack } from '../lib/useGoBack.js'
import { useUnsavedChanges, leaveWithoutPrompt } from '../lib/unsaved.jsx'

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
  const goBack = useGoBack()

  const [receipt, setReceipt] = useState(null)
  const [items, setItems] = useState([])
  const [meals, setMeals] = useState([])
  const [claims, setClaims] = useState([])
  const { group, memberships, switchGroup, myName, myMember, nameOf, idOf, members, refreshMembers } = useGroup()
  // { id, name } of the group this receipt belongs to, when it isn't the current one
  const [otherGroup, setOtherGroup] = useState(null)
  // Whose check-offs are being edited: me, or a guest on this receipt
  // (someone without an account) that I'm checking in for
  const [actingForId, setActingForId] = useState(null)
  const [copiedLinkFor, setCopiedLinkFor] = useState(null)
  const actor = actingForId
    ? { id: actingForId, name: nameOf(actingForId) }
    : myMember ? { id: myMember.id, name: myName } : null
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
  const unsavedDialog = useUnsavedChanges(isDirty, "Your check-offs aren't saved yet. Leave without saving them?")
  const bal = useBalances()

  const loadData = useCallback(async () => {
    const [receiptRes, checkinRes] = await Promise.all([
      supabase.from('receipts').select('*').eq('id', receiptId).single(),
      supabase.from('checkins').select('*').eq('receipt_id', receiptId),
    ])

    if (receiptRes.error) { setError('Receipt not found.'); setLoading(false); return }
    // Shared link to a receipt in another of my groups: switch to that group
    if (receiptRes.data.group_id !== group.id) {
      const other = memberships.find(m => m.group_id === receiptRes.data.group_id)
      if (!other) { setError('Receipt not found.'); setLoading(false); return }
      if (!canGoBack()) { switchGroup(other.group_id); return }
      setOtherGroup({ id: other.group_id, name: other.groups.name }); setLoading(false); return
    }
    setReceipt(receiptFromDb(receiptRes.data, nameOf))
    setCheckins((checkinRes.data || []).map(x => checkinFromDb(x, nameOf)))

    const [itemRes, mealRes] = await Promise.all([
      supabase.from('items').select('*').eq('receipt_id', receiptId).is('deleted_at', null)
        .order('position', { ascending: true, nullsFirst: false }).order('created_at'),
      supabase.from('meals').select('*').eq('receipt_id', receiptId).is('deleted_at', null).order('created_at').order('id'),
    ])
    if (itemRes.error || mealRes.error || checkinRes.error) { setError('Could not load this receipt. Check your connection and refresh.'); setLoading(false); return }
    const allItems = itemRes.data || []
    setItems(allItems)
    setMeals(mealRes.data || [])

    if (allItems.length > 0) {
      const { data: claimData, error: claimError } = await supabase
        .from('claims').select('*').in('item_id', allItems.map(i => i.id)).order('id')
      if (claimError) { setError('Could not load this receipt. Check your connection and refresh.'); setLoading(false); return }
      setClaims((claimData || []).map(c => claimFromDb(c, nameOf)))
    } else {
      setClaims([])
    }

    setLoading(false)
  }, [receiptId, nameOf, group.id])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Whose check-offs myClaims was last set from; fresh data for the same
  // person (e.g. a reload after copying a guest link) keeps unsaved changes
  const claimsForRef = useRef(null)
  useEffect(() => {
    if (!actor || items.length === 0) return
    if (isDirty && claimsForRef.current === actor.id) return
    claimsForRef.current = actor.id
    const mine = claims.filter(c => c.roommate === actor.name).map(c => c.item_id)
    const alwaysSplitIds = items.filter(i => i.always_split).map(i => i.id)
    // Checked in before (on any device: the check-in is in the database) →
    // show exactly what I claimed. Only a first visit starts with everything checked.
    const checkedIn = checkins.some(c => c.member_id === actor.id)
    const hasEverSaved = checkedIn || !!localStorage.getItem(`claimed-receipt-${receiptId}-${actor.id}`)
    if (mine.length > 0 || hasEverSaved) {
      setMyClaims(new Set([...mine, ...alwaysSplitIds]))
    } else {
      setMyClaims(new Set(items.map(i => i.id)))
    }
    claimsLoadedRef.current = true
    setIsDirty(false)
  }, [myName, actingForId, claims, items, checkins, receiptId])

  function toggleClaim(itemId) {
    if (!actor) return
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
    if (!actor) return
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
    if (!actor) return
    setSaving(true)
    const itemIds = items.map(i => i.id)
    const currentMine = new Set(claims.filter(c => c.roommate === actor.name).map(c => c.item_id))
    try {
      await syncMyClaims(actor.id, itemIds, currentMine, myClaims)
      await ensureCheckin(actor.id, receiptId)
      // Checking things off a receipt puts you on it (when it has a member list)
      const memberIds = receipt.member_ids || []
      if (memberIds.length && !memberIds.includes(actor.id) && myClaims.size > 0) {
        const nextIds = [...memberIds, actor.id]
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
    const newClaims = [...myClaims].map(item_id => ({ item_id, member_id: actor.id, roommate: actor.name }))

    localStorage.setItem(`claimed-receipt-${receiptId}-${actor.id}`, '1')
    setClaims(prev => [
      ...prev.filter(c => !(c.roommate === actor.name && itemIds.includes(c.item_id))),
      ...newClaims,
    ])
    setCheckins(prev => [
      ...prev.filter(c => c.roommate !== actor.name),
      { receipt_id: receiptId, member_id: actor.id, roommate: actor.name },
    ])
    setSaving(false)
    setSaved(true)
    setIsDirty(false)
    // The saved claims' ids decide who gets leftover cents; fetch them
    loadData()
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
    if (!await confirm(`Your $${Number(last.amount).toFixed(2)} payment to ${last.to} will be removed. This is recorded in the history.`, {
      title: 'Undo this payment?', confirmLabel: 'Remove payment', danger: true,
    })) return
    setSettling(true)
    try {
      await deletePayment(last.id)
      await bal.reload()
    } catch (err) {
      await showAlert(err.message, { title: 'Could not undo' })
    }
    setSettling(false)
  }

  async function switchActor(id) {
    if (id === actingForId) return
    if (isDirty && !await confirm('Your unsaved check-offs will be lost.', { title: 'Switch person?', confirmLabel: 'Switch', danger: true })) return
    setSaved(false)
    setActingForId(id)
  }

  // Copy a guest's link (making one first if they don't have one yet)
  async function copyGuestLink(m) {
    let failed = null
    // Start copying during the tap (Safari needs that), while the link is made
    const link = m.guest_token
      ? guestLinkUrl(m.guest_token)
      : supabase.rpc('guest_link_create', { p_member: m.id }).then(({ data, error }) => {
          if (error) { failed = error; throw error }
          return guestLinkUrl(data)
        })
    const copied = await copyText(link)
    if (!m.guest_token) refreshMembers()
    if (failed) { await showAlert(failed.message, { title: 'Could not make a link' }); return }
    if (!copied) { await showAlert(await link, { title: `${m.displayName}'s link (copy it from here)` }); return }
    setCopiedLinkFor(m.id)
    setTimeout(() => setCopiedLinkFor(null), 2000)
  }

  // Unsaved check-offs: asks however you leave (see useUnsavedChanges)
  function handleBack() {
    // Receipts live under the Receipts tab, so that's "back" from a shared link
    goBack('/receipts')
  }

  async function deleteReceipt() {
    if (!await confirm('It will be hidden for everyone, and the change is recorded in its history. To bring it back, open this receipt\'s link again and tap Restore.', {
      title: 'Delete receipt?', confirmLabel: 'Delete', danger: true,
    })) return
    const { error } = await supabase.from('receipts').update({ deleted_at: new Date().toISOString() }).eq('id', receiptId)
    if (error) { await showAlert(error.message, { title: 'Could not delete' }); return }
    leaveWithoutPrompt()
    goBack('/receipts')
  }

  async function restoreReceipt() {
    const { error } = await supabase.from('receipts').update({ deleted_at: null }).eq('id', receiptId)
    if (error) { await showAlert(error.message, { title: 'Could not restore' }); return }
    setReceipt(r => ({ ...r, deleted_at: null }))
  }

  async function copyLink() {
    if (!await copyText(window.location.href)) { await showAlert(window.location.href, { title: 'Copy this link' }); return }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const countedClaims = claims
  const syntheticClaims = actor ? [
    ...countedClaims.filter(c => c.roommate !== actor.name),
    ...[...myClaims].map(item_id => ({ item_id, roommate: actor.name })),
  ] : countedClaims
  const receiptArr = receipt ? [receipt] : []
  const runningTotal = actor
    ? calculateDebts(receiptArr, items, syntheticClaims, meals)
        .filter(d => d.debtor === actor.name)
        .reduce((s, d) => s + d.amount, 0)
    : 0
  const debts = calculateDebts(receiptArr, items, countedClaims, meals)
  const breakdown = getItemizedBreakdown(receiptArr, items, countedClaims, meals)

  const checkinNames = new Set(checkins.map(c => c.roommate.toLowerCase()))
  const receiptComplete = (receipt?.members || []).every(m => checkinNames.has(m.toLowerCase()))
  const receiptMembers = (() => {
    const base = receipt?.members || []
    const payer = receipt?.paid_by
    if (!payer || base.some(m => m.toLowerCase() === payer.toLowerCase())) return base
    return [...base, payer]
  })()
  const waitingOn = receiptMembers.filter(m => !checkinNames.has(m.toLowerCase()))

  // People on this receipt who can't check in themselves: no account, or no
  // longer in the group. Anyone can check off for them.
  const guestsOnReceipt = (members || []).filter(m => (!m.user_id || !m.active) && (receipt?.member_ids || []).includes(m.id))
  // Guest links only work for people still in the group
  const waitingGuests = guestsOnReceipt.filter(m => m.active && waitingOn.some(n => n.toLowerCase() === m.displayName.toLowerCase()))

  const itemsByMeal = {}
  for (const item of items) {
    if (item.meal_id) {
      if (!itemsByMeal[item.meal_id]) itemsByMeal[item.meal_id] = []
      itemsByMeal[item.meal_id].push(item)
    }
  }
  const ungroupedItems = items.filter(i => !i.meal_id)

  if (loading) return <div className="max-w-xl mx-auto p-8 text-gray-400">Loading…</div>
  if (otherGroup) {
    return (
      <div className="max-w-xl mx-auto p-8">
        <p className="text-gray-700">This receipt is in <span className="font-semibold">{otherGroup.name}</span>.</p>
        <div className="mt-4 flex gap-2">
          <button onClick={() => switchGroup(otherGroup.id)} className="px-4 py-2 text-sm font-medium rounded-lg bg-accent-600 text-white hover:bg-accent-700 transition">Switch to {otherGroup.name}</button>
          <BackButton onClick={() => goBack('/receipts')} />
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="max-w-xl mx-auto p-8">
        <p className="text-gray-700">{error === 'Receipt not found.' ? "This receipt doesn't exist, or it's in a group you're not in." : error}</p>
        <BackButton onClick={() => goBack('/receipts')} className="mt-4" />
      </div>
    )
  }

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
    {unsavedDialog}
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
            onClick={() => navigate(`/receipt/${receiptId}/edit`, { state: { fromReceipt: true } })}
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

      {/* Waiting on (with a link to send anyone who doesn't have an account) */}
      {waitingOn.length > 0 && items.length > 0 && (
        <div className="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="shrink-0">Still waiting on:</span>
            <span className="font-medium">{formatWaitingOn(waitingOn, myName)}</span>
          </div>
          {waitingGuests.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {waitingGuests.map(m => (
                <button key={m.id} onClick={() => copyGuestLink(m)} className="px-2.5 py-1 text-xs font-medium bg-white border border-amber-200 rounded-lg hover:bg-amber-100 transition">
                  {copiedLinkFor === m.id ? 'Link copied ✓' : `Copy ${m.displayName}'s link`}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Check off for a guest (someone without an account) instead of yourself */}
      {myName && items.length > 0 && guestsOnReceipt.length > 0 && (
        <div className="mb-3 flex items-center gap-2 flex-wrap text-sm">
          <span className="text-gray-500">Checking off for:</span>
          {[{ id: null, label: 'You' }, ...guestsOnReceipt.map(m => ({ id: m.id, label: m.displayName }))].map(o => (
            <button
              key={o.id || 'me'}
              onClick={() => switchActor(o.id)}
              className={`px-3 py-1 rounded-full text-sm font-medium border transition ${actingForId === o.id ? 'bg-accent-600 text-white border-accent-600' : 'bg-white text-gray-600 border-gray-300 hover:border-accent-400'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      {/* Items */}
      {items.length === 0 ? (
        <div className="py-8 flex flex-col items-center">
          <button
            onClick={() => navigate(`/receipt/${receiptId}/edit`, { state: { fromReceipt: true } })}
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
              const mealFee = Number(meal.fee) || 0
              const mealTotal = mealItems.reduce((s, i) => s + Number(i.price), 0) + mealFee
              return (
                <Fragment key={meal.id}>
                  {/* Tapping the row opens the meal; its checkbox (with a large tap
                      area) checks or unchecks all of its items */}
                  <li
                    className="flex items-center gap-3 px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100"
                    onClick={() => toggleExpandMeal(meal.id)}
                  >
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); toggleMealGroup(meal.id, mealItems) }}
                      disabled={!myName}
                      aria-label={`Check off all of ${meal.name}`}
                      className="-m-3 p-3 shrink-0 flex"
                    >
                      <input
                        type="checkbox"
                        checked={checkState === 'all'}
                        ref={el => { if (el) el.indeterminate = checkState === 'some' }}
                        readOnly
                        tabIndex={-1}
                        disabled={!myName}
                        className="h-4 w-4 rounded accent-accent-600 pointer-events-none"
                      />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-700">{meal.name}</p>
                      <p className="text-xs text-gray-400">
                        {mealItems.length} item{mealItems.length !== 1 ? 's' : ''}
                        {mealFee > 0 && ` · includes $${mealFee.toFixed(2)} fee`}
                      </p>
                    </div>
                    <span className="text-sm font-medium text-gray-700 shrink-0">${mealTotal.toFixed(2)}</span>
                    <span className="text-gray-400 px-1 shrink-0" aria-hidden="true">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={expanded ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
                      </svg>
                    </span>
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
              if (f) parts.push(`Fees $${f.toFixed(2)}`)
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
              <p className="text-xs text-gray-400">{actingForId ? `${actor.name}'s running total` : 'Your running total'}</p>
              <p className="text-xl font-bold text-accent-600">${runningTotal.toFixed(2)}</p>
            </div>
            <button
              onClick={saveClaims}
              disabled={saving}
              className="px-5 py-2 bg-accent-600 text-white font-semibold rounded-xl hover:bg-accent-700 transition disabled:opacity-50 min-w-[140px] whitespace-nowrap text-center"
            >
              {saving ? 'Saving…' : saved ? 'Saved ✓' : actingForId ? `Save for ${actor.name}` : 'Save my claims'}
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
                              className="text-sm px-3 py-1.5 -my-1 rounded-md text-accent-600 font-medium hover:bg-gray-50 transition disabled:opacity-50" title="Undo your payment for this receipt">
                              ✓ Sent
                            </button>
                          ) : <span className="text-xs text-accent-600 font-medium">✓ Paid</span>
                        ) : myName === d.debtor ? (
                          <button onClick={() => markSent(d, st.remaining)} disabled={settling}
                            className="text-sm px-3 py-1.5 -my-1 border border-accent-200 text-accent-600 rounded-md hover:bg-accent-50 transition disabled:opacity-50">
                            Mark sent
                          </button>
                        ) : myName === d.creditor ? (
                          <button onClick={() => markSent(d, st.remaining)} disabled={settling}
                            className="text-sm px-3 py-1.5 -my-1 border border-gray-200 text-gray-500 rounded-md hover:bg-gray-50 transition disabled:opacity-50">
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
