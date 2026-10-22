import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useGroup } from '../lib/group.jsx'
import { recordPayment } from '../lib/db.js'
import { useDialog } from '../lib/useDialog.jsx'
import SettleUpDialog from './SettleUpDialog.jsx'
import { ChevronRight } from './Icons.jsx'
import { money, SETTLE_SENT, SETTLE_RECEIVED, SETTLE_SMALL } from '../lib/ui.js'

const fmtShort = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''

// "3 receipts ▾" under a person's name, so it's clear the row expands. An
// overpayment isn't a receipt, so it's named separately.
function ReceiptCountToggle({ receipts, overpaid, expanded }) {
  const parts = []
  if (receipts) parts.push(`${receipts} receipt${receipts === 1 ? '' : 's'}`)
  if (overpaid) parts.push(receipts ? 'overpayment' : 'Overpaid earlier')
  return (
    <p className="flex items-center gap-0.5 text-xs text-gray-500 mt-0.5">
      {expanded ? 'Hide details' : parts.join(' + ')}
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d={expanded ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
      </svg>
    </p>
  )
}

// One person's balance with you: name, total, and (expanded) the receipts
// still unpaid. Open amounts always add up to the total.
function PersonBalance({ entry, showDirection, expanded, onToggle, onSettle, onMarkReceipt, busy }) {
  const selectionAtPress = useRef('')
  return (
    <li className="border border-gray-100 rounded-lg overflow-hidden">
      <div
        className="flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-gray-50 active:bg-gray-100 transition cursor-pointer select-none"
        // Selecting text (to copy an amount) shouldn't open/close the row; a
        // selection left over from before still lets a plain click through
        onMouseDown={() => { selectionAtPress.current = window.getSelection()?.toString() || '' }}
        onClick={() => {
          const selection = window.getSelection()?.toString() || ''
          if (!selection || selection === selectionAtPress.current) onToggle()
        }}
      >
        <div className="min-w-0">
          <p className="text-gray-700 truncate">
            {!showDirection ? <span className="font-medium text-gray-900">{entry.person}</span>
              : entry.iOwe ? <>You owe <span className="font-semibold text-gray-900">{entry.person}</span></>
              : <><span className="font-semibold text-gray-900">{entry.person}</span> owes you</>}
          </p>
          <ReceiptCountToggle receipts={entry.open.length} overpaid={entry.fromPayments > 0} expanded={expanded} />
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <span onClick={e => e.stopPropagation()} className={`font-semibold tabular-nums select-text cursor-text ${entry.iOwe ? 'text-amber-600' : 'text-accent-600'}`}>{money(entry.amount)}</span>
          <button
            data-settle-button
            onClick={e => { e.stopPropagation(); onSettle() }}
            disabled={busy}
            className={entry.iOwe ? SETTLE_SENT : SETTLE_RECEIVED}
          >
            {entry.iOwe ? 'Mark sent' : 'Mark received'}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-gray-100 p-1.5 space-y-0.5">
          {entry.open.map(o => (
            <div key={o.receiptId} className="flex items-center gap-1.5">
              {/* The whole row opens the receipt (with a › so it reads as a link) */}
              <Link
                to={`/receipt/${o.receiptId}`}
                className="flex-1 min-w-0 flex items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-gray-50 active:bg-gray-100"
              >
                <span className="min-w-0">
                  <span className="block truncate text-gray-800 font-medium">{o.label}</span>
                  <span className="block text-xs text-gray-400">
                    {fmtShort(o.date)}
                    {o.remaining < o.cents && ` · ${money(o.cents / 100)} total, partly paid`}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  <span className="text-gray-900 tabular-nums">{money(o.remaining / 100)}</span>
                  <ChevronRight className="w-4 h-4 text-gray-300" />
                </span>
              </Link>
              {entry.iOwe && (
                <button data-settle-button onClick={() => onMarkReceipt(o)} disabled={busy} className={SETTLE_SMALL}>Mark sent</button>
              )}
            </div>
          ))}
          {entry.fromPayments > 0 && (
            <div className="flex items-center justify-between text-sm gap-2 px-1.5 py-1.5">
              <span className="text-gray-700">Overpaid earlier <span className="text-gray-400 text-xs">(from payments, not a receipt)</span></span>
              <span className="text-gray-900 shrink-0 tabular-nums">{money(entry.fromPayments)}</span>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

// People you owe / who owe you, each expandable to its receipts, with
// "Mark sent" / "Mark received" (whole balance, via the settle-up dialog) and
// per-receipt "Mark sent". Used on Home and Balances. showDirection writes
// "You owe X" / "X owes you" for lists that mix both directions.
export default function BalanceRows({ entries, reload, showDirection = false }) {
  const { group, myName, idOf } = useGroup()
  const { showAlert, DialogUI } = useDialog()
  const [busy, setBusy] = useState(false)
  const [settle, setSettle] = useState(null) // { from, to, amount, title }
  const [expanded, setExpanded] = useState(new Set())

  function toggle(person) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(person) ? next.delete(person) : next.add(person)
      return next
    })
  }

  async function savePayment({ from, to, amount, receiptId = null, note = null }) {
    await recordPayment({ groupId: group.id, fromId: idOf(from), toId: idOf(to), amount, receiptId, note })
    await reload()
  }

  // "Mark sent" on one receipt: pay what's left on it
  async function markReceiptPaid(entry, open) {
    setBusy(true)
    try {
      await savePayment({ from: myName, to: entry.person, amount: open.remaining / 100, receiptId: open.receiptId })
    } catch (err) {
      await showAlert(err.message, { title: 'Could not save payment' })
    }
    setBusy(false)
  }

  function openSettle(entry) {
    setSettle(entry.iOwe
      ? { from: myName, to: entry.person, amount: entry.amount, title: `Mark sent to ${entry.person}` }
      : { from: entry.person, to: myName, amount: entry.amount, title: `Mark received from ${entry.person}` })
  }

  return (
    <>
      {DialogUI}
      {settle && (
        <SettleUpDialog
          {...settle}
          onClose={() => setSettle(null)}
          onSave={async ({ amount, note }) => { await savePayment({ ...settle, amount, note }); setSettle(null) }}
        />
      )}
      <ul className="space-y-1.5">
        {entries.map(entry => (
          <PersonBalance
            key={entry.person}
            entry={entry}
            showDirection={showDirection}
            expanded={expanded.has(entry.person)}
            onToggle={() => toggle(entry.person)}
            onSettle={() => openSettle(entry)}
            onMarkReceipt={open => markReceiptPaid(entry, open)}
            busy={busy}
          />
        ))}
      </ul>
    </>
  )
}
