import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

// Locks the page behind while any dialog is open (counted, for a dialog
// opened from a dialog). The page doesn't shift: its scrollbar's room is
// kept (scrollbar-gutter in index.css).
let openCount = 0
function lockScroll() {
  if (openCount++ === 0) document.documentElement.style.overflow = 'hidden'
  return () => { if (--openCount === 0) document.documentElement.style.overflow = '' }
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Every dialog in the app (confirm/alert, settle up, day picker):
// - drawn at the top of the page (a portal), so nothing it's written inside
//   (a faded row, the nav bar) can fade or clip it
// - focus moves in (to `initialFocus`, an [autofocus]/[data-autofocus]
//   element, or the first button), Tab stays inside, and closing puts focus
//   back where it was
// - Escape or a tap on the backdrop closes it, unless `dismissible` is false;
//   a press that starts inside the card (selecting text) and ends outside
//   doesn't count
// - the page behind doesn't scroll
// - `top`: on phones it sits near the top, clear of the keyboard (forms)
export default function Modal({ onClose, title, children, role = 'dialog', dismissible = true, initialFocus, top = false, className = 'p-6' }) {
  const cardRef = useRef(null)
  const downOnBackdrop = useRef(false)
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const dismissRef = useRef(dismissible)
  dismissRef.current = dismissible

  useEffect(() => {
    const before = document.activeElement
    const unlock = lockScroll()
    const card = cardRef.current
    const first = initialFocus?.current || card.querySelector('[autofocus], [data-autofocus]') || card.querySelector(FOCUSABLE)
    ;(first || card).focus({ preventScroll: true })

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation()
        if (dismissRef.current) closeRef.current?.()
        return
      }
      if (e.key !== 'Tab') return
      const items = [...card.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null)
      if (!items.length) { e.preventDefault(); return }
      const [firstItem, lastItem] = [items[0], items[items.length - 1]]
      if (e.shiftKey && (document.activeElement === firstItem || !card.contains(document.activeElement))) { e.preventDefault(); lastItem.focus() }
      else if (!e.shiftKey && (document.activeElement === lastItem || !card.contains(document.activeElement))) { e.preventDefault(); firstItem.focus() }
    }
    // Capture, so Escape closes this and not a menu or page behind it
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      unlock()
      if (before && document.contains(before)) before.focus({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <div
      className={`animate-fade fixed inset-0 z-[60] flex justify-center p-4 bg-black/40 backdrop-blur-sm ${top ? 'items-start pt-[12vh] sm:items-center sm:pt-4' : 'items-center'}`}
      onPointerDown={e => { downOnBackdrop.current = e.target === e.currentTarget }}
      onClick={e => { if (downOnBackdrop.current && e.target === e.currentTarget && dismissRef.current) onClose?.() }}
    >
      <div
        ref={cardRef}
        role={role}
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`animate-pop bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto scroll-slim focus:outline-none ${className}`}
      >
        {title && <h2 id={titleId} className="font-semibold text-gray-900 text-lg leading-snug">{title}</h2>}
        {children}
      </div>
    </div>,
    document.body,
  )
}
