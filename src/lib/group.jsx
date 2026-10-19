import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import { useSession } from './session.jsx'
import { computeDisplayNames } from './names.js'

const GroupContext = createContext(null)
const currentGroupKey = uid => `current-group-${uid}`

const titleCase = s => s.trim().replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

// computeDisplayNames lives in names.js (no React/Supabase, so it's testable)
export { computeDisplayNames }

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

  // The group being shown; a slow load for a group we've switched away from is dropped
  const groupIdRef = useRef(groupId)
  groupIdRef.current = groupId
  const loadMembers = useCallback(async () => {
    if (!groupId) { setMembers(null); return }
    const { data } = await supabase.from('group_members').select('*').eq('group_id', groupId).order('created_at')
    if (groupIdRef.current === groupId) setMembers(data || [])
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
      // A bare first name ("Alex") matches the one person with it; if several
      // share it ("Alex K." / "Alex M."), ask which instead of adding a third
      const byFirst = name => withNames.filter(m => m.active && m.first_name.trim().toLowerCase() === name.toLowerCase())
      const wanted = nameList.map(n => String(n || '').trim()).filter(Boolean).map(n => {
        if (idOf(n)) return n
        const matches = byFirst(n)
        if (matches.length === 1) return matches[0].displayName
        if (matches.length > 1) {
          throw new Error(`There's more than one ${titleCase(n)}: ${matches.map(m => m.displayName).join(', ')}. Use the full name.`)
        }
        return n
      })
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

// "Waiting on you, Alex": my own name becomes "you", listed first
export function formatWaitingOn(names, myName) {
  const me = (myName || '').toLowerCase()
  const others = names.filter(n => n.toLowerCase() !== me)
  return [...(others.length < names.length ? ['you'] : []), ...others].join(', ')
}
