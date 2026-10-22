import { useId, useState } from 'react'
import Modal from './Modal.jsx'
import StableLabel from './StableLabel.jsx'
import { FIELD, money } from '../lib/ui.js'

// Record a payment: "{from} paid {to} $amount". Amount starts at the full
// balance and can be lowered for a partial payment.
export default function SettleUpDialog({ from, to, amount, title, onSave, onClose }) {
  const [value, setValue] = useState(amount.toFixed(2))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const parsed = Number(value)
  const valid = parsed > 0 && /^\d*\.?\d{0,2}$/.test(value)
  const amountId = useId()
  const noteId = useId()

  async function save(e) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      await onSave({ amount: parsed, note: note.trim() })
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  // While saving, the payment is already on its way: closing then would look
  // like cancelling it, so the dialog stays until it's done
  return (
    <Modal title={title} onClose={onClose} dismissible={!saving} top>
      <form onSubmit={save} className="space-y-4">
        <p className="text-sm text-gray-500 -mt-0.5">{from} → {to}</p>
        <div>
          <label htmlFor={amountId} className="text-xs font-medium text-gray-500">Amount</label>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
            <input
              id={amountId}
              autoFocus
              inputMode="decimal"
              enterKeyHint="done"
              value={value}
              // Typing replaces the full amount (for a partial payment)
              onFocus={e => e.target.select()}
              onChange={e => setValue(e.target.value.replace(/[^\d.]/g, ''))}
              className={`${FIELD} pl-7 !text-lg font-semibold tabular-nums`}
            />
          </div>
          {valid && parsed < amount - 0.005 && (
            <p className="text-xs text-gray-400 mt-1">Partial payment: {money(amount - parsed)} will still be owed.</p>
          )}
          {valid && parsed > amount + 0.005 && (
            <p className="text-xs text-amber-600 mt-1">That's more than the {money(amount)} owed. The extra will show as owed back.</p>
          )}
        </div>
        <div>
          <label htmlFor={noteId} className="text-xs font-medium text-gray-500">Note (optional)</label>
          <input
            id={noteId}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. Venmo"
            enterKeyHint="done"
            className={`${FIELD} mt-1`}
          />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 sm:flex-none px-4 h-10 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 active:bg-gray-100 text-gray-700 transition disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={!valid || saving} className="flex-1 sm:flex-none px-4 h-10 text-sm font-medium rounded-lg bg-accent-600 text-white hover:bg-accent-700 active:bg-accent-700 transition disabled:opacity-50">
            <StableLabel current={saving ? 'Saving…' : 'Save'} labels={['Save', 'Saving…']} />
          </button>
        </div>
      </form>
    </Modal>
  )
}
