import { useEffect, useId, useRef, useState } from 'react'
import { useDismiss } from '../lib/useDismiss.js'
import { POPUP_PANEL, POPUP_ITEM_ACTIVE, opensUp, popupHeight } from '../lib/popup.js'

// The app's dropdown picker, used instead of the browser's <select> (which
// looks different on every device and puts its arrow at the very edge).
//   options: [{ value, label }]
//   small: text-sm, for compact forms
//
// How it behaves:
// - The current choice has a ✓. The green highlight is only where you are
//   right now: under the mouse (gone when the mouse leaves the list) or
//   where the arrow keys have moved to. Nothing is highlighted on opening.
// - Keyboard: arrows (starting from the current choice), Home/End, typing a
//   name's first letters jumps to it, Enter or Space picks, Escape/Tab close.
// - A long list opens scrolled to the current choice.
export default function Select({ value, onChange, options, placeholder = 'Choose…', invalid = false, small = false, className = '', ariaLabel }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1) // highlighted option (-1: none)
  const [up, setUp] = useState(false) // opens upward when there's no room below
  const ref = useRef(null)
  const listRef = useRef(null)
  const typed = useRef({ text: '', at: 0 })
  const id = useId()
  useDismiss(open, ref, () => setOpen(false))
  const selectedIndex = options.findIndex(o => o.value === value)
  const selected = options[selectedIndex]

  function toggle() {
    if (open) { setOpen(false); return }
    setActive(-1)
    setUp(opensUp(ref.current, popupHeight(options.length)))
    setOpen(true)
  }

  function pick(option) {
    setOpen(false)
    if (option.value !== value) onChange(option.value)
  }

  // Opening: show the current choice. Moving with the keyboard: keep the
  // highlighted option in view. Only the list scrolls, never the page (a page
  // scroll closes the list; see useDismiss).
  function reveal(i, center) {
    const list = listRef.current
    const row = list?.querySelector(`[data-index="${i}"]`)
    if (!row) return
    if (center) list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2
    else if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight
  }
  useEffect(() => { if (open) reveal(selectedIndex, true) }, [open])
  useEffect(() => { if (open && active >= 0) reveal(active, false) }, [active])

  // Typing letters jumps to the next name starting with them (like <select>)
  function typeahead(key) {
    const now = Date.now()
    const t = typed.current
    t.text = now - t.at > 700 ? key : t.text + key
    t.at = now
    const from = active >= 0 ? active : selectedIndex
    const starts = i => options[i].label.toLowerCase().startsWith(t.text.toLowerCase())
    // A new single letter moves on to the next match; more letters refine
    // this one. With nothing chosen yet, start from the top.
    const offset = t.text.length === 1 ? 1 : 0
    for (let n = 0; n < options.length; n++) {
      const i = from < 0 ? n : (from + offset + n) % options.length
      if (starts(i)) return i
    }
    return -1
  }

  function onKeyDown(e) {
    const last = options.length - 1
    if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const i = typeahead(e.key)
      if (i === -1) return
      e.preventDefault()
      if (open) setActive(i)
      else if (options[i].value !== value) onChange(options[i].value) // closed: picks it, like <select>
      return
    }
    // Closed: arrows open it (Enter and Space click the button, which opens it)
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); toggle() }
      return
    }
    // The first arrow press lands on the current choice (or the top)
    const from = active >= 0 ? active : -1
    const start = selectedIndex >= 0 ? selectedIndex : 0
    const moves = {
      ArrowDown: () => (from < 0 ? start : Math.min(last, from + 1)),
      ArrowUp: () => (from < 0 ? start : Math.max(0, from - 1)),
      Home: () => 0,
      End: () => last,
    }
    if (moves[e.key]) { e.preventDefault(); setActive(moves[e.key]()) }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (options[active]) pick(options[active])
      else setOpen(false)
    }
    else if (e.key === 'Tab') setOpen(false)
  }

  const text = small ? 'text-sm' : ''
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={toggle}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        // Says the choice too ("Paid by: Milo"), not just what the field is
        aria-label={ariaLabel ? `${ariaLabel}: ${selected?.label ?? placeholder}` : undefined}
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        title={selected?.label}
        // The ring: while open, or reached with the keyboard (not left on after a tap)
        className={`w-full h-11 sm:h-10 border rounded-lg pl-3 pr-9 bg-white text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 ${open ? 'ring-2 ring-accent-400' : ''} ${text} ${invalid ? 'border-red-400' : 'border-gray-300'}`}
      >
        <span className={`block truncate ${selected ? 'text-gray-900' : 'text-gray-400'}`}>{selected ? selected.label : placeholder}</span>
        <svg className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          // The mouse leaving the list takes the highlight with it
          onPointerLeave={e => { if (e.pointerType === 'mouse') setActive(-1) }}
          className={`absolute z-20 left-0 right-0 ${up ? 'bottom-full mb-1 animate-pop-up' : 'top-full mt-1 animate-pop'} max-h-60 overflow-auto scroll-slim ${POPUP_PANEL}`}
        >
          {options.length === 0 && <li className="px-3 py-2 text-sm text-gray-400">Nobody to choose yet</li>}
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-${i}`}
              data-index={i}
              role="option"
              aria-selected={o.value === value}
              title={o.label}
              // Keeps focus on the button, so the keyboard still works after a tap
              onMouseDown={e => e.preventDefault()}
              // A real mouse moving over it, not a tap or the list scrolling under a resting pointer
              onPointerMove={e => { if (e.pointerType === 'mouse' && active !== i) setActive(i) }}
              onClick={() => pick(o)}
              className={`flex items-center justify-between gap-2 px-3 py-2.5 sm:py-2 text-sm cursor-pointer ${
                i === active ? POPUP_ITEM_ACTIVE : o.value === value ? 'text-gray-900' : 'text-gray-700'
              } ${o.value === value ? 'font-medium' : ''}`}
            >
              <span className="truncate">{o.label}</span>
              {o.value === value && <span className="text-accent-600 shrink-0">✓</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
