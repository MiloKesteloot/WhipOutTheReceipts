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

export function claimFromDb(c, nameOf) {
  return { ...c, roommate: nameOf(c.member_id) }
}

export function checkinFromDb(c, nameOf) {
  return { ...c, roommate: nameOf(c.member_id) }
}

export function paymentFromDb(p, nameOf) {
  return { ...p, from: nameOf(p.from_member), to: nameOf(p.to_member), receiptId: p.receipt_id, paidAt: p.paid_at }
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
    supabase.from('checkins').select('id, receipt_id, member_id').in('member_id', memberIds))
  return rows.map(c => checkinFromDb(c, nameOf))
}

// "Not mine" on unclaimed items (item_dismissals, migration 20261022000000)
export async function loadDismissals(memberIds, nameOf) {
  if (!memberIds.length) return []
  const rows = await selectAll(() =>
    supabase.from('item_dismissals').select('item_id, member_id').in('member_id', memberIds), 'item_id')
  return rows.map(d => ({ ...d, roommate: nameOf(d.member_id) }))
}

// Say an unclaimed item isn't yours (no-op if already said)
export async function dismissItem(memberId, itemId) {
  const { error } = await supabase.from('item_dismissals')
    .upsert({ item_id: itemId, member_id: memberId }, { onConflict: 'item_id,member_id', ignoreDuplicates: true })
  if (error) throw error
}

// Claim one item ("It's mine"), keeping your other check-offs
export async function claimItem(memberId, itemId) {
  const { error } = await supabase.from('claims')
    .upsert({ item_id: itemId, member_id: memberId }, { onConflict: 'item_id,member_id', ignoreDuplicates: true })
  if (error) throw error
}

export async function loadPayments(groupId, nameOf) {
  const rows = await selectAll(() =>
    supabase.from('payments').select('*').eq('group_id', groupId).is('deleted_at', null))
  return rows.map(p => paymentFromDb(p, nameOf))
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
    // Already there (saved from another tab or device meanwhile) is fine
    const { error } = await supabase.from('claims')
      .upsert(toAdd.map(item_id => ({ item_id, member_id: memberId })), { onConflict: 'item_id,member_id', ignoreDuplicates: true })
    if (error) throw error
  }
}

// Record that a person has checked in on a receipt (no-op if already)
export async function ensureCheckin(memberId, receiptId) {
  const { error } = await supabase.from('checkins')
    .upsert({ member_id: memberId, receipt_id: receiptId }, { onConflict: 'receipt_id,member_id', ignoreDuplicates: true })
  if (error) throw error
}

// Record that `fromId` paid `toId` (optionally for a specific receipt)
export async function recordPayment({ groupId, fromId, toId, amount, receiptId = null, note = null }) {
  const { error } = await supabase.from('payments').insert({
    group_id: groupId, from_member: fromId, to_member: toId,
    amount: Math.round(Number(amount) * 100) / 100, receipt_id: receiptId, note: note || null,
  })
  if (error) throw error
}

// Payments are never hard-deleted; this hides one (kept in the history log)
export async function deletePayment(paymentId) {
  const { error } = await supabase.from('payments').update({ deleted_at: new Date().toISOString() }).eq('id', paymentId)
  if (error) throw error
}
