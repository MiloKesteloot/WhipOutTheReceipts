import { useEffect, useRef } from 'react'

// Popups (menus, dropdowns) close on:
// - a tap anywhere outside `ref` (including another popup's button)
// - Escape, which also puts focus back on the button that opened it
// - Tab moving focus out of it
// - the page scrolling (like a native menu: it would otherwise drift away
//   from its button or under the top bar). Scrolling inside it is fine.
export function useDismiss(open, ref, close) {
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    if (!open) return
    const inside = node => ref.current?.contains(node)
    const onDown = e => { if (!inside(e.target)) closeRef.current() }
    const onKey = e => {
      if (e.key !== 'Escape') return
      const trigger = ref.current?.querySelector('[aria-haspopup]')
      closeRef.current()
      trigger?.focus({ preventScroll: true })
    }
    const onFocus = e => { if (!inside(e.target)) closeRef.current() }
    const onScroll = e => { if (!inside(e.target)) closeRef.current() }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    document.addEventListener('focusin', onFocus)
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocus)
      window.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [open, ref])
}
