// Combining two edits of the same receipt (no React, so it's testable).
//
// You opened the receipt (base), changed it (mine), and meanwhile someone
// else saved their changes (theirs). merge3 keeps both sets of changes;
// only when you both changed the same thing differently is it a conflict,
// which the editor asks you about (keep yours or theirs). Nothing anyone
// did is dropped without asking.
//
// A receipt here:
//   { fields: { store_name, paid_by_member, category, tip, tax, fees, receipt_date },
//     member_ids: [...],
//     meals: [{ id (null if new), key, name, fee }],
//     items: [{ id (null if new), key, name, price, always_split, meal (a meal's id), meal_key (a new meal's key) }] }
// Items and meals are in order. `key` identifies a new item/meal on your side.
//
// merge3(base, mine, theirs, choices) → { result, conflicts }
//   conflicts: [{ key, kind, label, mine, theirs }] (kind: 'field', 'item',
//   'meal', 'itemRemovedByMe', 'itemRemovedByThem', 'mealRemovedByMe',
//   'mealRemovedByThem')
//   choices: { [conflict key]: 'mine' | 'theirs' }; a conflict without a
//   choice takes theirs in `result` (call again once everything is chosen).

const FIELDS = ['store_name', 'paid_by_member', 'category', 'tip', 'tax', 'fees', 'receipt_date']
// mealRef: the item's meal, an existing one's id or 'new:<key>' for a new one
const ITEM_FIELDS = ['name', 'price', 'always_split', 'mealRef']
const MEAL_FIELDS = ['name', 'fee']
const NUMERIC = new Set(['tip', 'tax', 'fees', 'price', 'fee'])

function norm(field, v) {
  if (NUMERIC.has(field)) return v === '' || v == null ? 0 : Math.round(Number(v) * 100) / 100
  if (field === 'always_split') return !!v
  if (typeof v === 'string') return v.trim()
  return v ?? null
}
const same = (field, a, b) => norm(field, a) === norm(field, b)

// Three-way on one value: whoever changed it wins; both changed it
// differently → conflict
function mergeValue(field, b, m, t, key, choices, conflicts, describe) {
  if (same(field, m, b)) return t
  if (same(field, t, b) || same(field, m, t)) return m
  conflicts.push({ key, ...describe, mine: m, theirs: t })
  return choices[key] === 'mine' ? m : t
}

const byId = list => new Map(list.filter(x => x.id).map(x => [x.id, x]))
const changed = (fields, a, b) => fields.some(f => !same(f, a[f], b[f]))

// The ids of base items in the order a side has them
const baseOrder = (list, baseIds) => list.filter(x => x.id && baseIds.has(x.id)).map(x => x.id)
const sameOrder = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

function mergeRows({ base, mine, theirs, fields, choices, conflicts, prefix, nameOf }) {
  const baseMap = byId(base)
  const mineMap = byId(mine)
  const theirsMap = byId(theirs)
  const kept = new Map() // id or key -> row

  for (const b of base) {
    const m = mineMap.get(b.id)
    const t = theirsMap.get(b.id)
    if (!m && !t) continue
    if (!m) {
      // I removed it; they changed it → ask; they didn't → it's gone
      if (!changed(fields, t, b)) continue
      const key = `${prefix}:${b.id}:removed`
      conflicts.push({ key, kind: `${prefix}RemovedByMe`, label: nameOf(t), mine: null, theirs: t })
      if (choices[key] !== 'mine') kept.set(b.id, { ...t })
      continue
    }
    if (!t) {
      // They removed it; I changed it → ask (keeping mine adds it back
      // as a new one); I didn't → it's gone
      if (!changed(fields, m, b)) continue
      const key = `${prefix}:${b.id}:removed`
      conflicts.push({ key, kind: `${prefix}RemovedByThem`, label: nameOf(m), mine: m, theirs: null })
      if (choices[key] === 'mine') kept.set(b.id, { ...m, id: null, key: m.key || `kept-${b.id}` })
      continue
    }
    const row = { ...t }
    for (const f of fields) {
      row[f] = mergeValue(f, b[f], m[f], t[f], `${prefix}:${b.id}:${f}`, choices, conflicts,
        { kind: prefix, field: f, label: nameOf(m) || nameOf(t) })
    }
    kept.set(b.id, row)
  }
  // New on my side, and new on theirs
  for (const m of mine) if (!m.id) kept.set(m.key, { ...m })
  for (const t of theirs) if (t.id && !baseMap.has(t.id)) kept.set(t.id, { ...t })

  // Order: whoever reordered the existing rows (mine first); the other
  // side's new rows go where they were relative to their neighbours
  const baseIds = new Set(base.map(x => x.id))
  const mineReordered = !sameOrder(baseOrder(mine, baseIds), baseOrder(base, baseIds))
  const [lead, other] = mineReordered ? [mine, theirs] : [theirs, mine]
  const idOf = x => x.id || x.key
  const order = lead.map(idOf).filter(k => kept.has(k))
  // Rows the lead side doesn't have (removed there but kept, or new on the other side)
  const placed = new Set(order)
  let prev = null
  for (const x of other) {
    const k = idOf(x)
    if (!kept.has(k)) continue
    if (!placed.has(k)) {
      const at = prev == null ? 0 : order.indexOf(prev) + 1
      order.splice(at, 0, k)
      placed.add(k)
    }
    prev = k
  }
  // Kept rows neither list has in place (mine kept after they removed it)
  for (const k of kept.keys()) if (!placed.has(k)) order.push(k)
  return order.map(k => kept.get(k))
}

export function merge3(base, mine, theirs, choices = {}) {
  const conflicts = []

  const fields = {}
  for (const f of FIELDS) {
    fields[f] = mergeValue(f, base.fields[f], mine.fields[f], theirs.fields[f], `field:${f}`, choices, conflicts, { kind: 'field', field: f })
  }

  // People: everyone on either side, minus anyone either side took off
  const removed = new Set(base.member_ids.filter(id => !mine.member_ids.includes(id) || !theirs.member_ids.includes(id)))
  const member_ids = [...new Set([...theirs.member_ids, ...mine.member_ids])].filter(id => !removed.has(id))

  const meals = mergeRows({ base: base.meals, mine: mine.meals, theirs: theirs.meals, fields: MEAL_FIELDS, choices, conflicts, prefix: 'meal', nameOf: m => m?.name })
  const withRef = list => list.map(i => ({ ...i, mealRef: i.meal || (i.meal_key ? `new:${i.meal_key}` : null) }))
  const merged = mergeRows({ base: withRef(base.items), mine: withRef(mine.items), theirs: withRef(theirs.items), fields: ITEM_FIELDS, choices, conflicts, prefix: 'item', nameOf: i => i?.name })

  // Back to meal / meal_key; an item can't stay in a meal that's gone
  const mealIds = new Set(meals.filter(m => m.id).map(m => m.id))
  const mealKeys = new Set(meals.filter(m => !m.id).map(m => m.key))
  const items = merged.map(({ mealRef, ...i }) => {
    if (mealRef?.startsWith('new:') && mealKeys.has(mealRef.slice(4))) return { ...i, meal: null, meal_key: mealRef.slice(4) }
    if (mealRef && mealIds.has(mealRef)) return { ...i, meal: mealRef, meal_key: null }
    return { ...i, meal: null, meal_key: null }
  })

  return { result: { fields, member_ids, meals, items }, conflicts }
}

// What save_receipt takes (supabase/migrations/20261023000000_live_updates.sql)
export function toSaveData(r) {
  return {
    ...r.fields,
    member_ids: r.member_ids,
    meals: r.meals.map(m => ({ id: m.id || null, key: m.key || m.id, name: m.name, fee: norm('fee', m.fee) })),
    items: r.items.map((i, position) => ({
      id: i.id || null, name: i.name, price: norm('price', i.price), always_split: !!i.always_split,
      meal: i.meal || null, meal_key: i.meal ? null : (i.meal_key || null), position,
    })),
  }
}

// A receipt as loaded from the database (receipt row, its items and meals,
// not deleted) in merge3's shape
export function fromDb(receipt, items, meals) {
  return {
    fields: Object.fromEntries(FIELDS.map(f => [f, receipt[f] ?? null])),
    member_ids: [...(receipt.member_ids || [])],
    meals: [...meals].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '') || a.id.localeCompare(b.id))
      .map(m => ({ id: m.id, key: m.id, name: m.name, fee: Number(m.fee) || 0 })),
    items: [...items].sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || (a.created_at || '').localeCompare(b.created_at || ''))
      .map(i => ({ id: i.id, key: i.id, name: i.name, price: Number(i.price), always_split: !!i.always_split, meal: i.meal_id || null, meal_key: null })),
  }
}
