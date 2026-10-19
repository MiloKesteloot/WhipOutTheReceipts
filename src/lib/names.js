// Joining a group as a new person: would your name be confused with
// someone already in it? (The database checks the same rule in
// name_clash(), migration 20261018080000.)
//
//   null         fine
//   'needs_last' someone has your first name and you have no last name
//   'same_name'  someone has your exact first and last name
//
// A different last name is enough: the group shows "Alex K." and "Alex M."
export function nameClash({ first_name, last_name }, others) {
  const first = norm(first_name)
  const last = norm(last_name)
  const sameFirst = others.filter(o => o.active !== false && norm(o.first_name) === first)
  if (!sameFirst.length) return null
  if (!last) return 'needs_last'
  return sameFirst.some(o => norm(o.last_name) === last) ? 'same_name' : null
}

const norm = s => String(s || '').trim().toLowerCase()

/**
 * Unique display name per person within a group: first name, plus a last
 * initial only when first names collide ("Alex K." / "Alex M."), then the
 * full last name, then a number as a last resort. Case-insensitive.
 * Returns Map(memberId -> displayName).
 */
export function computeDisplayNames(members) {
  const result = new Map()
  const byFirst = new Map()
  for (const m of members) {
    const key = m.first_name.trim().toLowerCase()
    if (!byFirst.has(key)) byFirst.set(key, [])
    byFirst.get(key).push(m)
  }
  const taken = new Set()
  const claim = (m, name) => { result.set(m.id, name); taken.add(name.toLowerCase()) }

  for (const group of byFirst.values()) {
    const first = group[0].first_name.trim()
    if (group.length === 1) { claim(group[0], first); continue }
    const candidates = [
      m => m.last_name?.trim() ? `${first} ${m.last_name.trim()[0].toUpperCase()}.` : null,
      m => m.last_name?.trim() ? `${first} ${m.last_name.trim()}` : null,
    ]
    let remaining = [...group].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    for (const make of candidates) {
      const counts = new Map()
      for (const m of remaining) {
        const n = make(m)
        if (n) counts.set(n.toLowerCase(), (counts.get(n.toLowerCase()) || 0) + 1)
      }
      remaining = remaining.filter(m => {
        const n = make(m)
        if (n && counts.get(n.toLowerCase()) === 1 && !taken.has(n.toLowerCase())) { claim(m, n); return false }
        return true
      })
    }
    // Same first name and no distinguishing last name: number them
    remaining.forEach((m, i) => {
      let n = i === 0 && !taken.has(first.toLowerCase()) ? first : `${first} (${i + 1})`
      while (taken.has(n.toLowerCase())) n = `${n}'`
      claim(m, n)
    })
  }
  return result
}
