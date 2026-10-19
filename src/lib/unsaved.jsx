import { useEffect } from 'react'
import { useBlocker } from 'react-router-dom'
import { useDialog } from './useDialog.jsx'

// Pages with unsaved work (a receipt draft, unsaved check-offs) ask before
// it's thrown away, however you leave: a link, the tab bar, Back, the phone's
// back gesture. Refreshing or closing the tab gets the browser's own prompt.

let dirty = false
let bypass = false

// For things that change the page without a route change (switching group)
export const hasUnsavedChanges = () => dirty

// Leaving on purpose (after saving, deleting, or already confirming): the
// next navigation away goes through without asking
export function leaveWithoutPrompt() { bypass = true }

// Returns the dialog element to render
// includeSearch: also ask when only the query string changes (a page that
// keeps what's open in ?r=…)
export function useUnsavedChanges(isDirty, message, { includeSearch = false } = {}) {
  const { confirm, DialogUI } = useDialog()

  useEffect(() => {
    dirty = isDirty
    return () => { dirty = false }
  }, [isDirty])

  // Reset when the page goes away (the bypass is for leaving this page)
  useEffect(() => () => { bypass = false }, [])

  useEffect(() => {
    if (!isDirty) return
    const onUnload = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [isDirty])

  const where = loc => loc.pathname + (includeSearch ? loc.search : '')
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    isDirty && !bypass && where(currentLocation) !== where(nextLocation))

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    confirm(message, { title: 'Unsaved changes', confirmLabel: 'Leave', cancelLabel: 'Stay', danger: true })
      .then(ok => {
        if (ok) { bypass = true; blocker.proceed() } else blocker.reset()
      })
  }, [blocker.state])

  return DialogUI
}
