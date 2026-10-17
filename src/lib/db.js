// Database <-> page data. The database stores people as group_members ids;
// pages work with display names (unique within a group), which keeps the
// split math and page logic name-based. Convert here, at the boundary.
import { supabase } from './supabase.js'

// ── Rows from the database → page shape ──────────────────────
// Only fields present in the row are converted, so partial selects work.
export function receiptFromDb(r, nameOf) {
  const out = { ...r }
  if ('paid_by_member' in r) out.paid_by = nameOf(r.paid_by_member)
  if ('member_ids' in r) out.members = (r.member_ids || []).map(nameOf)
  return out
}

export function tripFromDb(t, nameOf) {
  const out = { ...t }
  if ('member_ids' in t) out.members = (t.member_ids || []).map(nameOf)
  return out
}

export function claimFromDb(c, nameOf) {
  return { ...c, roommate: nameOf(c.member_id) }
}

export function checkinFromDb(c, nameOf) {
  return { ...c, roommate: nameOf(c.member_id) }
}

export function settlementFromDb(s, nameOf) {
  return { ...s, debtor: nameOf(s.debtor_member), creditor: nameOf(s.creditor_member) }
}

// ── Paging ───────────────────────────────────────────────────
// Supabase returns at most 1000 rows per request. `build` must return a
// fresh query each call; results are ordered by `orderBy` for stable pages.
export async function selectAll(build, orderBy = 'id') {
  const PAGE = 1000
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().order(orderBy).range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...data)
    if (data.length < PAGE) return rows
  }
}

// ── Whole-group loads ────────────────────────────────────────
// Each loader returns non-deleted rows for the current group, in page shape.

export async function loadReceipts(groupId, nameOf, columns = '*', { datedOnly = false } = {}) {
  const rows = await selectAll(() => {
    let q = supabase.from('receipts').select(columns).eq('group_id', groupId).is('deleted_at', null)
    if (datedOnly) q = q.not('receipt_date', 'is', null)
    return q
  })
  return rows.map(r => receiptFromDb(r, nameOf))
}

export async function loadTrips(groupId, nameOf, columns = '*') {
  const rows = await selectAll(() =>
    supabase.from('trips').select(columns).eq('group_id', groupId).is('deleted_at', null))
  return rows.map(t => tripFromDb(t, nameOf))
}

// Items (and meals) belong to a group through their receipt
export async function loadItems(groupId, columns = 'id, receipt_id, meal_id, name, price') {
  const rows = await selectAll(() =>
    supabase.from('items').select(`${columns}, receipts!inner(group_id, deleted_at)`)
      .eq('receipts.group_id', groupId).is('receipts.deleted_at', null).is('deleted_at', null))
  return rows.map(({ receipts, ...item }) => item)
}

export async function loadMeals(groupId, columns = 'id, receipt_id, name, fee') {
  const rows = await selectAll(() =>
    supabase.from('meals').select(`${columns}, receipts!inner(group_id, deleted_at)`)
      .eq('receipts.group_id', groupId).is('receipts.deleted_at', null).is('deleted_at', null))
  return rows.map(({ receipts, ...meal }) => meal)
}

// Claims/checkins always reference a person in the same group (enforced by
// RLS), so filtering by the group's member ids scopes them to the group.
// Claims on deleted items are still returned; callers join claims to items.
export async function loadClaims(memberIds, nameOf) {
  if (!memberIds.length) return []
  const rows = await selectAll(() =>
    supabase.from('claims').select('id, item_id, member_id').in('member_id', memberIds))
  return rows.map(c => claimFromDb(c, nameOf))
}

export async function loadCheckins(memberIds, nameOf) {
  if (!memberIds.length) return []
  const rows = await selectAll(() =>
    supabase.from('checkins').select('id, receipt_id, trip_id, member_id').in('member_id', memberIds))
  return rows.map(c => checkinFromDb(c, nameOf))
}

export async function loadSettlements(groupId, nameOf) {
  const rows = await selectAll(() => supabase.from('settlements').select('*').eq('group_id', groupId))
  return rows.map(s => settlementFromDb(s, nameOf))
}

// ── Writes ───────────────────────────────────────────────────

// Make my claims on `itemIds` match `wanted` (a Set of item ids), touching
// only what changed so the history log shows real check/uncheck actions.
export async function syncMyClaims(memberId, itemIds, currentMine, wanted) {
  const toAdd = [...wanted].filter(id => itemIds.includes(id) && !currentMine.has(id))
  const toRemove = [...currentMine].filter(id => itemIds.includes(id) && !wanted.has(id))
  if (toRemove.length) {
    const { error } = await supabase.from('claims').delete().eq('member_id', memberId).in('item_id', toRemove)
    if (error) throw error
  }
  if (toAdd.length) {
    const { error } = await supabase.from('claims').insert(toAdd.map(item_id => ({ item_id, member_id: memberId })))
    if (error) throw error
  }
}

// Record that a person has checked in on a receipt or trip (no-op if already)
export async function ensureCheckin(memberId, { receiptId = null, tripId = null }) {
  let q = supabase.from('checkins').select('id').eq('member_id', memberId)
  q = receiptId ? q.eq('receipt_id', receiptId) : q.is('receipt_id', null)
  q = tripId ? q.eq('trip_id', tripId) : q.is('trip_id', null)
  const { data } = await q.limit(1)
  if (data?.length) return
  const { error } = await supabase.from('checkins').insert({ member_id: memberId, receipt_id: receiptId, trip_id: tripId })
  if (error) throw error
}

// Mark a debt as sent: one settlement row per (receipt|trip, debtor, creditor)
export async function setSettlement({ groupId, receiptId = null, tripId = null, debtorId, creditorId, amount }) {
  let q = supabase.from('settlements').select('id').eq('debtor_member', debtorId).eq('creditor_member', creditorId)
  q = receiptId ? q.eq('receipt_id', receiptId) : q.is('receipt_id', null)
  q = tripId ? q.eq('trip_id', tripId) : q.is('trip_id', null)
  const { data: existing } = await q
  if (existing?.length) {
    const [keep, ...dupes] = existing
    if (dupes.length) await supabase.from('settlements').delete().in('id', dupes.map(d => d.id))
    const { error } = await supabase.from('settlements').update({ amount, settled_at: new Date().toISOString() }).eq('id', keep.id)
    if (error) throw error
    return
  }
  const { error } = await supabase.from('settlements').insert({
    group_id: groupId, receipt_id: receiptId, trip_id: tripId,
    debtor_member: debtorId, creditor_member: creditorId, amount,
  })
  if (error) throw error
}

export async function clearSettlement({ receiptId = null, tripId = null, debtorId, creditorId }) {
  let q = supabase.from('settlements').delete().eq('debtor_member', debtorId).eq('creditor_member', creditorId)
  q = receiptId ? q.eq('receipt_id', receiptId) : q.is('receipt_id', null)
  q = tripId ? q.eq('trip_id', tripId) : q.is('trip_id', null)
  const { error } = await q
  if (error) throw error
}
