// Small line icons that match the rest of the UI (emoji render in full
// color and look different on every phone)

const base = 'shrink-0'

// ✓ for on, + for off (chips that toggle)
export function CheckOrPlus({ on, className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={`${base} ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={on ? 'M5 13l4 4L19 7' : 'M12 5v14M5 12h14'} />
    </svg>
  )
}

// Padlock, closed (split with everyone) or open
export function LockIcon({ locked = true, className = 'w-4 h-4' }) {
  return (
    <svg className={`${base} ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path strokeLinecap="round" d={locked ? 'M8 11V7a4 4 0 018 0v4' : 'M8 11V7a4 4 0 017.75-1.4'} />
    </svg>
  )
}

// ⋯ (more actions)
export function DotsIcon({ className = 'w-5 h-5' }) {
  return (
    <svg className={`${base} ${className}`} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="19" cy="12" r="1.75" />
    </svg>
  )
}

// › (opens something)
export function ChevronRight({ className = 'w-4 h-4' }) {
  return (
    <svg className={`${base} ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  )
}

// ✕ (remove)
export function XIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={`${base} ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}
