import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useGroup } from '../lib/group.jsx'

const money = v => `$${Number(v || 0).toFixed(2)}`
const fmtWhen = ts => new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const MERGE_WINDOW_MS = 5 * 60 * 1000

// Turn one audit row into a sentence fragment (without the actor), or null to hide it
function describe(e, { nameOf, itemName, mealName }) {
  const o = e.old_data || {}
  const n = e.new_data || {}
  const changed = k => e.action === 'update' && JSON.stringify(o[k]) !== JSON.stringify(n[k])

  switch (e.table_name) {
    case 'receipts': {
      if (e.action === 'insert') return 'created this receipt'
      if (changed('deleted_at')) return n.deleted_at ? 'deleted this receipt' : 'restored this receipt'
      const parts = []
      if (changed('store_name')) parts.push(`renamed it to "${n.store_name}"`)
      if (changed('paid_by_member')) parts.push(`changed who paid to ${nameOf(n.paid_by_member)}`)
      if (changed('receipt_date')) parts.push(`changed the date to ${n.receipt_date}`)
      if (changed('category')) parts.push(`changed the category to ${n.category}`)
      for (const k of ['tip', 'tax', 'fees']) {
        if (changed(k)) parts.push(`changed ${k === 'fees' ? 'fees' : k} from ${money(o[k])} to ${money(n[k])}`)
      }
      if (changed('member_ids')) {
        const added = (n.member_ids || []).filter(id => !(o.member_ids || []).includes(id)).map(nameOf)
        const removed = (o.member_ids || []).filter(id => !(n.member_ids || []).includes(id)).map(nameOf)
        if (added.length) parts.push(`added ${added.join(', ')} to the receipt`)
        if (removed.length) parts.push(`removed ${removed.join(', ')} from the receipt`)
      }
      return parts.length ? parts.join(', ') : null
    }
    case 'items': {
      if (e.action === 'insert') return `added "${n.name}" (${money(n.price)})`
      if (changed('deleted_at')) return n.deleted_at ? `removed "${o.name}" (${money(o.price)})` : `restored "${n.name}"`
      const parts = []
      if (changed('name')) parts.push(`renamed "${o.name}" to "${n.name}"`)
      if (changed('price')) parts.push(`changed the price of "${n.name}" from ${money(o.price)} to ${money(n.price)}`)
      if (changed('always_split')) parts.push(`${n.always_split ? 'locked' : 'unlocked'} "${n.name}" as split by everyone`)
      if (changed('meal_id')) parts.push(n.meal_id ? `moved "${n.name}" into ${mealName(n.meal_id)}` : `moved "${n.name}" out of ${mealName(o.meal_id)}`)
      return parts.length ? parts.join(', ') : null
    }
    case 'meals': {
      if (e.action === 'insert') return `added meal "${n.name}"`
      if (changed('deleted_at')) return n.deleted_at ? `removed meal "${o.name}"` : `restored meal "${n.name}"`
      const parts = []
      if (changed('name')) parts.push(`renamed meal "${o.name}" to "${n.name}"`)
      if (changed('fee')) parts.push(`changed the "${n.name}" fee from ${money(o.fee)} to ${money(n.fee)}`)
      return parts.length ? parts.join(', ') : null
    }
    case 'settlements': {
      const row = e.action === 'delete' ? o : n
      const who = `${nameOf(row.debtor_member)} → ${nameOf(row.creditor_member)}`
      if (e.action === 'delete') return `unmarked a payment (${who})`
      return `marked ${row.amount != null ? money(row.amount) : 'a payment'} as sent (${who})`
    }
    case 'claims': {
      const row = e.action === 'delete' ? o : n
      return { claim: true, verb: e.action === 'delete' ? 'unchecked' : 'checked', item: itemName(row.item_id), forMember: row.member_id }
    }
    default:
      return null
  }
}

export default function ReceiptHistory({ receiptId }) {
  const { group, members, nameOf } = useGroup()
  const [entries, setEntries] = useState(null)
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [{ data: direct }, { data: itemRows }, { data: mealRows }] = await Promise.all([
        supabase.from('audit_log').select('*').eq('group_id', group.id)
          .or(`row_id.eq.${receiptId},new_data->>receipt_id.eq.${receiptId},old_data->>receipt_id.eq.${receiptId}`)
          .order('created_at', { ascending: false }).limit(500),
        supabase.from('items').select('id, name').eq('receipt_id', receiptId),
        supabase.from('meals').select('id, name').eq('receipt_id', receiptId),
      ])
      const itemIds = (itemRows || []).map(i => i.id)
      let claimRows = []
      if (itemIds.length) {
        const list = itemIds.join(',')
        const { data } = await supabase.from('audit_log').select('*').eq('group_id', group.id).eq('table_name', 'claims')
          .or(`new_data->>item_id.in.(${list}),old_data->>item_id.in.(${list})`)
          .order('created_at', { ascending: false }).limit(1000)
        claimRows = data || []
      }
      if (cancelled) return
      const all = [...(direct || []), ...claimRows]
        .filter(e => e.table_name !== 'checkins')
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
      setEntries({ all, items: itemRows || [], meals: mealRows || [] })
    }
    load()
    return () => { cancelled = true }
  }, [receiptId, group.id])

  if (!entries) return null

  const memberByUser = new Map(members.filter(m => m.user_id).map(m => [m.user_id, m]))
  const itemNames = new Map(entries.items.map(i => [i.id, i.name]))
  const mealNames = new Map(entries.meals.map(m => [m.id, m.name]))
  const ctx = {
    nameOf,
    itemName: id => `"${itemNames.get(id) || 'an item'}"`,
    mealName: id => `"${mealNames.get(id) || 'a meal'}"`,
  }

  // Build display lines, merging bursts of claim changes by the same person
  const lines = []
  for (const e of entries.all) {
    const text = describe(e, ctx)
    if (!text) continue
    const actorMember = memberByUser.get(e.actor)
    const actor = actorMember ? actorMember.displayName : 'Someone'
    if (text.claim) {
      const forOther = actorMember && text.forMember !== actorMember.id ? ` for ${nameOf(text.forMember)}` : ''
      const key = `${e.actor}|${text.verb}|${forOther}`
      const last = lines[lines.length - 1]
      if (last?.claimKey === key && new Date(last.oldest) - new Date(e.created_at) < MERGE_WINDOW_MS) {
        if (!last.items.includes(text.item)) last.items.unshift(text.item)
        last.oldest = e.created_at
        continue
      }
      lines.push({ id: e.id, actor, at: e.created_at, oldest: e.created_at, claimKey: key, verb: text.verb, items: [text.item], forOther })
      continue
    }
    lines.push({ id: e.id, actor, at: e.created_at, text })
  }
  const hasCreation = entries.all.some(e => e.table_name === 'receipts' && e.action === 'insert')
  const visible = showAll ? lines : lines.slice(0, 15)

  return (
    <div className="mt-6 bg-white border border-gray-200 rounded-xl p-4">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between text-left">
        <span className="font-semibold text-gray-800">History</span>
        <span className="flex items-center gap-2 text-xs text-gray-400">
          {lines.length} change{lines.length === 1 ? '' : 's'}
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d={open ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
          </svg>
        </span>
      </button>
      {open && (
        <ul className="mt-3 space-y-2">
          {visible.map(l => (
            <li key={l.id} className="text-sm text-gray-600 flex justify-between gap-3">
              <span className="min-w-0">
                <span className="font-medium text-gray-800">{l.actor}</span>{' '}
                {l.text || `${l.verb} ${l.items.join(', ')}${l.forOther}`}
              </span>
              <span className="text-xs text-gray-400 shrink-0 mt-0.5">{fmtWhen(l.at)}</span>
            </li>
          ))}
          {lines.length > visible.length && (
            <li><button onClick={() => setShowAll(true)} className="text-xs text-accent-600 font-medium">Show all {lines.length}</button></li>
          )}
          {!hasCreation && (
            <li className="text-xs text-gray-400 pt-1">
              {lines.length ? 'Earlier changes' : 'Changes to this receipt'} from before history tracking started aren't shown.
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
