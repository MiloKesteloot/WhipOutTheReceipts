import { useEffect, useState } from 'react'

// Record a payment: "{from} paid {to} $amount". Amount starts at the full
// balance and can be lowered for a partial payment.
export default function SettleUpDialog({ from, to, amount, title, onSave, onClose }) {
  const [value, setValue] = useState(amount.toFixed(2))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const parsed = Number(value)
  const valid = parsed > 0 && /^\d*\.?\d{0,2}$/.test(value)

  // While saving, the payment is already on its way: closing then would look
  // like cancelling it, so the dialog stays until it's done
  const close = () => { if (!saving) onClose() }

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={close}>
      <form onSubmit={save} onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <p className="text-sm text-gray-500 mt-0.5">{from} → {to}</p>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500">Amount</label>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
            <input
              autoFocus
              inputMode="decimal"
              value={value}
              onChange={e => setValue(e.target.value.replace(/[^\d.]/g, ''))}
              className="w-full border border-gray-300 rounded-xl pl-7 pr-3 py-2.5 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-accent-400"
            />
          </div>
          {valid && parsed < amount - 0.005 && (
            <p className="text-xs text-gray-400 mt-1">Partial payment: ${(amount - parsed).toFixed(2)} will still be owed.</p>
          )}
          {valid && parsed > amount + 0.005 && (
            <p className="text-xs text-amber-600 mt-1">That's more than the ${amount.toFixed(2)} owed. The extra will show as owed back.</p>
          )}
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500">Note (optional)</label>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. Venmo"
            className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
          />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={close} disabled={saving} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={!valid || saving} className="px-4 py-2 text-sm font-medium rounded-lg bg-accent-600 text-white hover:bg-accent-700 transition disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
