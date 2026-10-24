import { useSyncExternalStore } from 'react'

// Dev only: press 7 to show a page's loading skeleton instead of the page
// (and 7 again to go back), to check how well the two line up. Not typed into
// fields, and never in the deployed build.
let on = false
const listeners = new Set()

if (import.meta.env.DEV) {
  window.addEventListener('keydown', e => {
    if (e.key !== '7' || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return
    on = !on
    listeners.forEach(fn => fn())
  })
}

export function useSkeletonPreview() {
  return useSyncExternalStore(
    fn => { listeners.add(fn); return () => listeners.delete(fn) },
    () => on,
  )
}
