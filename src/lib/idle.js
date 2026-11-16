// "Nothing moves while you're using it": live updates that would change
// what's on screen wait until you've stopped touching, scrolling and typing
// for a moment, and nothing (a dialog, a menu) is open. Otherwise a row
// could appear or vanish just as you tap, and your tap would land on the
// one that slid into its place.
//
// whenIdle(key, fn): run fn once things are idle (now, if they already
// are). A newer call with the same key replaces the waiting one, so only
// the latest data is applied.

const QUIET_MS = 1200
const CHECK_MS = 250

let pointerDown = false
let lastActivity = 0
const waiting = new Map()
let timer = null

function activity() { lastActivity = Date.now() }

if (typeof window !== 'undefined') {
  const opts = { capture: true, passive: true }
  window.addEventListener('pointerdown', () => { pointerDown = true; activity() }, opts)
  window.addEventListener('pointerup', () => { pointerDown = false; activity() }, opts)
  window.addEventListener('pointercancel', () => { pointerDown = false; activity() }, opts)
  window.addEventListener('touchstart', activity, opts)
  window.addEventListener('wheel', activity, opts)
  window.addEventListener('scroll', activity, opts)
  window.addEventListener('keydown', activity, opts)
}

// Something open that a change could pull out from under you
function somethingOpen() {
  const el = document.activeElement
  if (el && (el.matches?.('input:not([type=checkbox]):not([type=radio]), textarea, select') || el.isContentEditable)) return true
  return !!document.querySelector('[aria-modal="true"], [role="menu"], [role="listbox"]')
}

export function isIdle() {
  if (typeof document === 'undefined') return true
  // A hidden page can't be tapped; it updates so it's current when you come back
  if (document.visibilityState === 'hidden') return true
  return !pointerDown && Date.now() - lastActivity >= QUIET_MS && !somethingOpen()
}

function check() {
  timer = null
  if (!isIdle()) { timer = setTimeout(check, CHECK_MS); return }
  const fns = [...waiting.values()]
  waiting.clear()
  for (const fn of fns) fn()
}

export function whenIdle(key, fn) {
  if (isIdle() && !waiting.size) { fn(); return }
  waiting.set(key, fn)
  if (!timer) timer = setTimeout(check, CHECK_MS)
}

// Drop a waiting update (its page went away)
export function cancelIdle(key) {
  waiting.delete(key)
}
