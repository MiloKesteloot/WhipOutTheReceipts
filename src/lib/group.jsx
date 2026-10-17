import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase.js'
import { useSession } from './session.jsx'

const GroupContext = createContext(null)
const currentGroupKey = uid => `current-group-${uid}`

const titleCase = s => s.trim().replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

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

export function GroupProvider({ children }) {
  const { user, profile } = useSession()
  const uid = user?.id
  const [memberships, setMemberships] = useState(null) // null = loading
  const [groupId, setGroupId] = useState(null)
  const [members, setMembers] = useState(null)

  const loadMemberships = useCallback(async () => {
    if (!uid) { setMemberships(null); return [] }
    const { data } = await supabase
      .from('group_members')
      .select('id, role, group_id, groups(id, name, invite_code, created_at)')
      .eq('user_id', uid).eq('active', true)
    const list = (data || []).filter(m => m.groups).sort((a, b) => a.groups.name.localeCompare(b.groups.name))
    setMemberships(list)
    return list
  }, [uid])

  useEffect(() => { loadMemberships() }, [loadMemberships, profile?.first_name, profile?.last_name])

  // Pick the current group: remembered choice, else the first one
  useEffect(() => {
    if (!memberships || !uid) return
    const saved = localStorage.getItem(currentGroupKey(uid))
    const valid = memberships.find(m => m.group_id === (groupId || saved))
    setGroupId(valid ? valid.group_id : memberships[0]?.group_id || null)
  }, [memberships, uid])

  const loadMembers = useCallback(async () => {
    if (!groupId) { setMembers(null); return }
    const { data } = await supabase.from('group_members').select('*').eq('group_id', groupId).order('created_at')
    setMembers(data || [])
  }, [groupId])

  useEffect(() => { setMembers(null); loadMembers() }, [loadMembers])

  function switchGroup(id) {
    localStorage.setItem(currentGroupKey(uid), id)
    setGroupId(id)
  }

  const value = useMemo(() => {
    const list = members || []
    const names = computeDisplayNames(list)
    const withNames = list.map(m => ({ ...m, displayName: names.get(m.id) }))
    const idByLower = new Map(withNames.map(m => [m.displayName.toLowerCase(), m.id]))
    const myMember = withNames.find(m => m.user_id === uid) || null
    const membership = memberships?.find(m => m.group_id === groupId)

    const nameOf = id => names.get(id) || 'Unknown'
    const idOf = name => (name ? idByLower.get(String(name).trim().toLowerCase()) : undefined)

    // Map names -> member ids, adding unknown names to the group as guests
    async function ensureMemberIds(nameList) {
      const wanted = nameList.map(n => String(n || '').trim()).filter(Boolean)
      const missing = [...new Set(wanted.filter(n => !idOf(n)).map(titleCase))]
      const created = new Map()
      if (missing.length) {
        const { data, error } = await supabase.from('group_members')
          .insert(missing.map(first_name => ({ group_id: groupId, first_name, is_guest: true })))
          .select('id, first_name')
        if (error) throw error
        for (const row of data) created.set(row.first_name.toLowerCase(), row.id)
        await loadMembers()
      }
      return wanted.map(n => idOf(n) || created.get(titleCase(n).toLowerCase()))
    }

    return {
      // Also loading while a group exists but hasn't been picked/loaded yet
      loading: memberships === null || (memberships.length > 0 && (!membership || members === null)),
      memberships: memberships || [],
      group: membership?.groups || null,
      isOwner: membership?.role === 'owner',
      switchGroup,
      refreshMemberships: loadMemberships,
      members: withNames,
      refreshMembers: loadMembers,
      myMember,
      myName: myMember ? names.get(myMember.id) : '',
      // Non-guest, active people: the default roster for new receipts and Stats
      coreNames: withNames.filter(m => m.active && !m.is_guest).map(m => m.displayName),
      memberIds: list.map(m => m.id),
      nameOf,
      idOf,
      ensureMemberIds,
    }
  }, [members, memberships, groupId, uid, loadMembers, loadMemberships])

  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>
}

export function useGroup() {
  return useContext(GroupContext)
}
