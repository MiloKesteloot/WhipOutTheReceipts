import { useState } from 'react'
import Modal from './Modal.jsx'
import { money } from '../lib/ui.js'

// Two people changed the same thing on a receipt (lib/receiptMerge.js):
// for each, keep yours or theirs. Everything else was combined already.
// onDone(choices) with { [conflict key]: 'mine' | 'theirs' }, or onDone(null)
// to go back to the form without saving.

const FIELD_LABELS = {
  store_name: 'Store', paid_by_member: 'Who paid', category: 'Category', receipt_date: 'Date',
  tip: 'Tip', tax: 'Tax', fees: 'Fees', name: 'Name', price: 'Price', always_split: 'Split by everyone',
  mealRef: 'Meal', fee: 'Fee',
}

function describe(c, { nameOf, mealName, who }) {
  const value = v => {
    if (c.field === 'paid_by_member') return nameOf(v)
    if (['tip', 'tax', 'fees', 'price', 'fee'].includes(c.field)) return money(v)
    if (c.field === 'always_split') return v ? 'Yes' : 'No'
    if (c.field === 'mealRef') return v ? mealName(v) : 'No meal'
    if (c.field === 'receipt_date') return v ? new Date(v + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No date'
    return v || '(blank)'
  }
  switch (c.kind) {
    case 'field':
      return { title: FIELD_LABELS[c.field], mine: value(c.mine), theirs: value(c.theirs) }
    case 'item': case 'meal':
      return { title: `${c.kind === 'meal' ? 'Meal' : ''} ${c.label} · ${FIELD_LABELS[c.field]}`.trim(), mine: value(c.mine), theirs: value(c.theirs) }
    case 'itemRemovedByMe': case 'mealRemovedByMe':
      return { title: c.label, mine: 'Remove it', theirs: `Keep it, with ${who}'s change` }
    case 'itemRemovedByThem': case 'mealRemovedByThem':
      return { title: c.label, mine: 'Keep it, with your change', theirs: `Leave it removed (${who} removed it)` }
    default:
      return { title: c.label || c.key, mine: 'Yours', theirs: 'Theirs' }
  }
}

export default function MergeConflicts({ conflicts, who = 'Someone', nameOf, mealName, onDone }) {
  const [choices, setChoices] = useState({})
  const allChosen = conflicts.every(c => choices[c.key])
  const option = (c, side, text) => (
    <label className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border cursor-pointer transition ${
      choices[c.key] === side ? 'border-accent-400 bg-accent-50' : 'border-gray-200 hover:border-gray-300'}`}>
      <input type="radio" name={c.key} checked={choices[c.key] === side} onChange={() => setChoices(p => ({ ...p, [c.key]: side }))}
        className="mt-0.5 accent-accent-600" />
      <span className="text-sm text-gray-800 min-w-0">
        <span className="block text-xs text-gray-400">{side === 'mine' ? 'Yours' : `${who}'s`}</span>
        <span className="break-words">{text}</span>
      </span>
    </label>
  )
  return (
    <Modal title="Someone else changed this receipt too" onClose={() => onDone(null)} dismissible={false}>
      <p className="text-sm text-gray-500 mt-1.5">
        {who} saved changes while you were editing. The rest of your changes and theirs are combined; for {conflicts.length === 1 ? 'this one' : 'these'}, pick which to keep.
      </p>
      <ul className="mt-4 space-y-4">
        {conflicts.map(c => {
          const d = describe(c, { nameOf, mealName, who })
          return (
            <li key={c.key} data-conflict={c.key}>
              <p className="text-sm font-medium text-gray-900 mb-1.5">{d.title}</p>
              <div className="space-y-1.5">
                {option(c, 'theirs', d.theirs)}
                {option(c, 'mine', d.mine)}
              </div>
            </li>
          )
        })}
      </ul>
      <div className="mt-5 flex gap-2">
        <button onClick={() => onDone(null)} className="flex-1 py-2.5 text-sm font-medium rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 active:bg-gray-100 transition">
          Back to editing
        </button>
        <button onClick={() => onDone(choices)} disabled={!allChosen}
          className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-accent-600 text-white hover:bg-accent-700 active:bg-accent-700 transition disabled:opacity-40">
          Save
        </button>
      </div>
    </Modal>
  )
}
