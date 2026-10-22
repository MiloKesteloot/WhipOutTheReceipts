// A button label that changes ("Save" → "Saving…" → "Saved ✓") without the
// button changing width: every label sits in the same spot and the button is
// as wide as the widest. Pass every label the button can show.
export default function StableLabel({ current, labels }) {
  return (
    <span className="inline-grid justify-items-center">
      {labels.map(label => (
        <span key={label} className={`col-start-1 row-start-1 ${label === current ? '' : 'invisible'}`} aria-hidden={label !== current}>
          {label}
        </span>
      ))}
    </span>
  )
}
