import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from './Modal.jsx'
import { markNoticesSeen } from '../lib/db.js'
import { whenIdle, cancelIdle } from '../lib/idle.js'
import { money } from '../lib/ui.js'

const fmtDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''

// On Home: someone changed the price of an item you checked off (most of
// the time a small fix). Is that ok, or do you want to look at the receipt?
//   notices: your unread price notices, each with its item and receipt
//   onSeen(): after marking them seen (Home loads its data again)
// Opens once you're not mid-tap (it can arrive live).
export default function PriceNotices({ notices, onSeen }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const key = notices.map(n => n.id).join(',')

  useEffect(() => {
    if (!key) { setOpen(false); return }
    whenIdle('price-notices', () => setOpen(true))
    return () => cancelIdle('price-notices')
  }, [key])

  if (!open || !notices.length) return null

  async function seen(ids) {
    setSaving(true)
    try { await markNoticesSeen(ids) } catch { /* shown again next time; nothing lost */ }
    setSaving(false)
    onSeen()
  }

  return (
    <Modal title={notices.length === 1 ? 'A price changed' : `${notices.length} prices changed`} onClose={() => { setOpen(false); seen(notices.map(n => n.id)) }}>
      <ul className="mt-3 space-y-3" data-price-notices>
        {notices.map(n => (
          <li key={n.id} className="text-sm text-gray-700">
            <p>
              <span className="font-medium text-gray-900">{n.actor}</span> changed <span className="font-medium text-gray-900">{n.item.name}</span> on{' '}
              {n.receipt.store_name || 'a receipt'} ({fmtDate(n.receipt.receipt_date)}) from{' '}
              <span className="tabular-nums line-through text-gray-400">{money(n.old_price)}</span> to{' '}
              <span className="tabular-nums font-semibold text-gray-900">{money(n.new_price)}</span>.
            </p>
            <button
              onClick={async () => { await seen([n.id]); navigate(`/receipt/${n.receipt_id}`) }}
              disabled={saving}
              className="mt-1 text-sm font-medium text-accent-600 hover:text-accent-700 disabled:opacity-50"
            >
              Look at the receipt →
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={() => { setOpen(false); seen(notices.map(n => n.id)) }}
        disabled={saving}
        className="mt-5 w-full py-2.5 text-sm font-semibold rounded-xl bg-accent-600 text-white hover:bg-accent-700 active:bg-accent-700 transition disabled:opacity-50"
      >
        {notices.length === 1 ? 'Looks good' : 'They look good'}
      </button>
    </Modal>
  )
}
