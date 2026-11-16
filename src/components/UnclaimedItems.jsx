import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { money } from '../lib/ui.js'
import StableLabel from './StableLabel.jsx'

const SHOWN = 3
const fmtDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''

// "Alex", "Alex and Niko", "Alex, Niko and Sam"
function listNames(names) {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// Items nobody claimed on finished receipts (see unclaimedForMe), on Home
// and the guest page. Everyone on the receipt sees them until someone
// claims it or they say it isn't theirs, and sees who has said that, so
// whoever bought it gets asked.
//   entries: unclaimedForMe(...)
//   onMine / onNotMine(entry): save it (the page reloads its data after)
//   receiptLink(receipt): where the receipt name goes (or onOpen for the guest page)
//   explainGone(entry): why an item someone else took care of is done
//     ("Alex claimed it"). Such items stay where they were, dimmed, until
//     you leave the page, so the list doesn't shift under your finger (live
//     updates); items you answer yourself go at once.
export default function UnclaimedItems({ entries, myName, onMine, onNotMine, receiptLink, onOpen, explainGone }) {
  const [busy, setBusy] = useState(null) // item id being saved
  const [showAll, setShowAll] = useState(false)
  const shownBefore = useRef([])
  const answered = useRef(new Set()) // answered here

  // What was shown stays in its place; gone ones dimmed; new ones at the end
  const current = new Map(entries.map(e => [e.item.id, e]))
  const list = shownBefore.current
    .filter(e => current.has(e.item.id) || !answered.current.has(e.item.id))
    .map(e => current.get(e.item.id) || { ...e, gone: true })
  for (const e of entries) if (!list.some(x => x.item.id === e.item.id)) list.push(e)
  shownBefore.current = list

  if (!list.length) return null
  const open = list.filter(e => !e.gone)
  const shown = showAll ? list : list.slice(0, SHOWN)
  const me = (myName || '').toLowerCase()

  async function act(fn, entry) {
    answered.current.add(entry.item.id)
    setBusy(entry.item.id)
    try { await fn(entry) } finally { setBusy(null) }
  }

  return (
    <section className="bg-white border border-amber-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-amber-50 border-b border-amber-100">
        <h2 className="font-semibold text-amber-800">
          {open.length === 0 ? 'All taken care of' : open.length === 1 ? 'Nobody claimed this item' : `Nobody claimed ${open.length} items`}
        </h2>
        <p className="text-xs text-amber-700 mt-0.5">If it's yours, claim it. Otherwise it's split between everyone on the receipt.</p>
      </div>
      <ul className="divide-y divide-gray-100">
        {shown.map(entry => {
          const { item, receipt, everyone, dismissedBy } = entry
          const youreIn = everyone.some(n => n.toLowerCase() === me)
          const each = Number(item.price) / Math.max(1, everyone.length)
          const others = dismissedBy.filter(n => n.toLowerCase() !== me)
          const label = `${receipt.store_name || 'Receipt'} · ${fmtDate(receipt.receipt_date)}`
          const saving = busy === item.id
          return (
            <li key={item.id} className={`px-4 py-3 ${entry.gone ? 'opacity-50' : ''}`} data-gone={entry.gone || undefined}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium text-gray-900 truncate">{item.name}</p>
                <span className="text-sm font-semibold text-gray-900 tabular-nums shrink-0">{money(item.price)}</span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {receiptLink
                  ? <Link to={receiptLink(receipt)} className="text-gray-500 underline decoration-gray-300 underline-offset-2 hover:text-gray-700">{label}</Link>
                  : <button onClick={() => onOpen?.(receipt)} className="text-gray-500 underline decoration-gray-300 underline-offset-2 hover:text-gray-700">{label}</button>}
                {' · '}paid by {receipt.paid_by}
              </p>
              <p className="text-sm text-gray-600 mt-1.5">
                If nobody claims it, it's split between {youreIn ? `all ${everyone.length} of you` : `${everyone.length} people`}
                {' '}<span className="whitespace-nowrap">(about {money(each)} each).</span>
              </p>
              {others.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">{listNames(others)} {others.length === 1 ? 'says' : 'say'} it's not theirs.</p>
              )}
              {entry.gone ? (
                // Taken care of by someone else: no buttons (the row stays put)
                <p className="text-sm font-medium text-gray-600 mt-2.5 h-9 flex items-center">{explainGone?.(entry) || 'Taken care of'}</p>
              ) : (
              <div className="flex gap-2 mt-2.5">
                <button
                  onClick={() => act(onMine, entry)}
                  disabled={!!busy}
                  className="flex-1 sm:flex-none h-9 px-4 rounded-lg text-sm font-medium bg-accent-600 text-white hover:bg-accent-700 active:bg-accent-700 transition disabled:opacity-50"
                >
                  <StableLabel current={saving ? 'Saving…' : "It's mine"} labels={["It's mine", 'Saving…']} />
                </button>
                <button
                  onClick={() => act(onNotMine, entry)}
                  disabled={!!busy}
                  className="flex-1 sm:flex-none h-9 px-4 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 active:bg-gray-100 transition disabled:opacity-50"
                >
                  Not mine
                </button>
              </div>
              )}
            </li>
          )
        })}
      </ul>
      {list.length > SHOWN && (
        <button onClick={() => setShowAll(s => !s)} className="w-full px-4 py-3 text-sm font-medium text-accent-600 border-t border-gray-100 hover:bg-gray-50 active:bg-gray-100 transition">
          {showAll ? 'Show fewer' : `Show ${list.length - SHOWN} more`}
        </button>
      )}
    </section>
  )
}
