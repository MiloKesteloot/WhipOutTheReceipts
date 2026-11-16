import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

// Who has a receipt open in the editor right now (Supabase Realtime
// Presence). The editor announces itself; anyone viewing the receipt sees
// who's editing it. Closing the editor, or losing the connection (a phone
// asleep), takes you off the list on its own, so a lock can't get stuck.
//
// useEditors(receiptId, { editing, memberId }) → [{ key, member_id, since, mine }]
// in the order they started (the first one holds the lock). `mine` marks
// this tab's own entry. Only ids travel (names come from the group).
//
// Everyone on a receipt has to share one channel name, and Supabase hands
// back an existing channel for a name still in use (even one closing), so
// each receipt has one channel here, shared by the receipt page and the
// editor, and closed only after the last one stops using it.

const tabKey = crypto.randomUUID()
const rooms = new Map() // receiptId -> { channel, users: Set, editor, subscribed, closing }

function listEditors(channel) {
  const byKey = new Map()
  for (const [key, metas] of Object.entries(channel.presenceState())) {
    for (const m of metas) {
      if (!m.editing) continue
      const e = { key, member_id: m.member_id, since: m.since, mine: key === tabKey }
      if (!byKey.has(key) || byKey.get(key).since > e.since) byKey.set(key, e)
    }
  }
  return [...byKey.values()].sort((a, b) => a.since - b.since || a.key.localeCompare(b.key))
}

function announce(room) {
  if (!room.subscribed) return
  if (room.editor) room.channel.track({ editing: true, ...room.editor })
  else room.channel.untrack()
}

async function openRoom(receiptId) {
  // A channel by this name still closing: let it finish first
  const old = rooms.get(receiptId)
  if (old?.closing) await old.closing
  if (rooms.has(receiptId) && !rooms.get(receiptId).closing) return rooms.get(receiptId)
  const room = { users: new Set(), editor: null, subscribed: false, closing: null }
  room.channel = supabase.channel(`receipt-edit-${receiptId}`, { config: { presence: { key: tabKey } } })
  room.channel
    .on('presence', { event: 'sync' }, () => {
      const list = listEditors(room.channel)
      for (const fn of room.users) fn(list)
    })
    .subscribe(status => {
      if (status === 'SUBSCRIBED') { room.subscribed = true; announce(room) }
      else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') room.subscribed = false
    })
  rooms.set(receiptId, room)
  return room
}

function leaveRoom(receiptId, room, fn) {
  room.users.delete(fn)
  if (room.users.size > 0) return
  room.closing = supabase.removeChannel(room.channel).catch(() => {}).then(() => {
    if (rooms.get(receiptId) === room) rooms.delete(receiptId)
  })
}

export function useEditors(receiptId, { editing = false, memberId = null } = {}) {
  const [editors, setEditors] = useState([])
  useEffect(() => {
    if (!receiptId) return
    let room = null
    let gone = false
    const fn = list => { if (!gone) setEditors(list) }
    openRoom(receiptId).then(r => {
      if (gone) return
      room = r
      room.users.add(fn)
      if (editing && memberId) { room.editor = { member_id: memberId, since: Date.now() }; announce(room) }
      if (room.subscribed) fn(listEditors(room.channel))
    })
    return () => {
      gone = true
      setEditors([])
      if (!room) return
      if (editing && room.editor?.member_id === memberId) { room.editor = null; announce(room) }
      leaveRoom(receiptId, room, fn)
    }
  }, [receiptId, editing, memberId])
  return editors
}
