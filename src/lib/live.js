import { supabase } from './supabase.js'

// Live updates: one Supabase Realtime channel for the current group. Pages
// don't patch themselves from the rows that arrive; they hear "something
// changed" (with what changed, to skip what isn't theirs) and load again,
// the same way they load when opened, so totals and balances come from the
// same tested code.
//
// - A burst (saving a receipt writes many rows) becomes one batch.
// - Changes made while the connection was down are never sent again, so
//   coming back to the app, getting back online, or the channel recovering
//   from an error all send a batch with all: true (load everything).
//
// onLive(fn) → unsubscribe. fn gets { all, events: [{ table, type, row, old }] }.

const TABLES = ['receipts', 'items', 'meals', 'claims', 'checkins', 'payments', 'item_dismissals', 'receipt_notices', 'group_members', 'groups']
// These have the group's id on them, so the server can skip other groups'
// rows (the rest are limited to your groups by the row permissions)
const GROUP_FILTER = { receipts: 'group_id', payments: 'group_id', group_members: 'group_id', groups: 'id' }
const BATCH_MS = 400
const RETRY_MS = [1000, 3000, 10000, 30000]
// Back after this long away (the tab hidden, the phone locked): load everything
const AWAY_MS = 2000

const listeners = new Set()
let groupId = null
let channel = null
let retries = 0
let retryTimer = null
let everSubscribed = false
let pending = null
let flushTimer = null
let hiddenAt = null

export function onLive(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function queue(event) {
  pending ||= { all: false, events: [] }
  if (event === 'all') pending.all = true
  else pending.events.push(event)
  clearTimeout(flushTimer)
  flushTimer = setTimeout(flush, BATCH_MS)
}

function flush() {
  const batch = pending
  pending = null
  if (!batch) return
  for (const fn of [...listeners]) {
    try { fn(batch) } catch (err) { console.error('live update listener failed', err) }
  }
}

// Send a batch now, as if the server had (tests and "load everything")
export function refreshAll() {
  queue('all')
}

function subscribe() {
  if (!groupId) return
  const id = groupId
  let ch = supabase.channel(`group-${id}-${Date.now()}`)
  for (const table of TABLES) {
    const column = GROUP_FILTER[table]
    ch = ch.on('postgres_changes', { event: '*', schema: 'public', table, ...(column && { filter: `${column}=eq.${id}` }) }, payload => {
      queue({ table, type: payload.eventType, row: payload.new || {}, old: payload.old || {} })
    })
  }
  channel = ch
  ch.subscribe(status => {
    if (channel !== ch) return
    if (status === 'SUBSCRIBED') {
      // Back after a drop: anything missed meanwhile is never sent, so load it all
      if (everSubscribed) queue('all')
      everSubscribed = true
      retries = 0
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      scheduleRetry()
    }
  })
}

function unsubscribe() {
  clearTimeout(retryTimer)
  retryTimer = null
  if (channel) {
    const old = channel
    channel = null
    supabase.removeChannel(old)
  }
}

function scheduleRetry() {
  if (retryTimer || !groupId) return
  const wait = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)]
  retries++
  retryTimer = setTimeout(() => {
    retryTimer = null
    unsubscribe()
    subscribe()
  }, wait)
}

// The group being shown (null when signed out or between groups). Switching
// drops the old group's channel first, so its changes stop arriving.
export function setLiveGroup(id) {
  if (id === groupId) return
  unsubscribe()
  groupId = id
  everSubscribed = false
  retries = 0
  pending = null
  clearTimeout(flushTimer)
  if (id) subscribe()
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return }
    const away = hiddenAt != null && Date.now() - hiddenAt >= AWAY_MS
    hiddenAt = null
    if (!away || !groupId) return
    queue('all')
    // The socket may have died quietly while asleep
    if (!channel || channel.state !== 'joined') { unsubscribe(); subscribe() }
  })
  window.addEventListener('online', () => {
    if (!groupId) return
    queue('all')
    unsubscribe()
    subscribe()
  })
}

// Which batches matter to a page (kept apart so they're testable without Supabase)
export { touchesReceipt, touchesTables } from './liveMatch.js'
