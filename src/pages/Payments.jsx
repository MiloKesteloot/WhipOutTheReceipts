import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useGroup } from '../lib/group.jsx'
import { useBalances } from '../lib/useBalances.js'
import { deletePayment } from '../lib/db.js'
import { useDialog } from '../lib/useDialog.jsx'

const fmtDate = ts => {
  if (!ts) return null
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function Payments() {
  const { myName } = useGroup()
  const { loading, data, reload } = useBalances()
  const { confirm, DialogUI } = useDialog()
  const [tab, setTab] = useState('sent')
  const [expanded, setExpanded] = useState(new Set())

  if (loading) return <div className="max-w-2xl mx-auto p-8 text-gray-400">Loading…</div>

  const me = myName.toLowerCase()
  const receiptLabel = Object.fromEntries(data.receipts.map(r => [r.id, r.store_name || 'Receipt']))

  // Group my payments by the other person, newest first
  function build(direction) {
    const byPerson = {}
    for (const p of data.payments) {
      const sent = p.from.toLowerCase() === me
      const received = p.to.toLowerCase() === me
      if (direction === 'sent' ? !sent : !received) continue
      const other = sent ? p.to : p.from
      ;(byPerson[other] ||= []).push(p)
    }
    return Object.entries(byPerson)
      .map(([name, entries]) => ({
        name,
        entries: entries.sort((a, b) => (b.paidAt || '').localeCompare(a.paidAt || '')),
        total: entries.reduce((s, p) => s + Number(p.amount), 0),
      }))
      .sort((a, b) => b.total - a.total)
  }
  const sentList = build('sent')
  const receivedList = build('received')
  const activeList = tab === 'sent' ? sentList : receivedList
  const sentTotal = sentList.reduce((s, e) => s + e.total, 0)
  const receivedTotal = receivedList.reduce((s, e) => s + e.total, 0)

  function toggleExpanded(key) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  async function remove(p) {
    if (!await confirm(`$${Number(p.amount).toFixed(2)} from ${p.from} to ${p.to} will be removed and the balance goes back up. This is recorded in the history.`, {
      title: 'Remove this payment?', confirmLabel: 'Remove', danger: true,
    })) return
    await deletePayment(p.id)
    reload()
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {DialogUI}
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Payment History</h1>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">You sent</p>
          <p className="text-2xl font-bold text-gray-900">${sentTotal.toFixed(2)}</p>
          <p className="text-xs text-gray-400 mt-0.5">to {sentList.length} {sentList.length === 1 ? 'person' : 'people'}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">You received</p>
          <p className="text-2xl font-bold text-accent-600">${receivedTotal.toFixed(2)}</p>
          <p className="text-xs text-gray-400 mt-0.5">from {receivedList.length} {receivedList.length === 1 ? 'person' : 'people'}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5 mb-4 w-fit">
        {[['sent', `Sent (${sentList.length})`], ['received', `Received (${receivedList.length})`]].map(([v, label]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* List */}
      {activeList.length === 0 ? (
        <div className="py-16 text-center text-gray-400 text-sm">
          No {tab === 'sent' ? 'outgoing' : 'incoming'} payments recorded yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {activeList.map(({ name, total, entries }) => {
            const key = `${tab}-${name}`
            const open = expanded.has(key)
            return (
              <li key={key} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <button
                  onClick={() => toggleExpanded(key)}
                  className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                      tab === 'sent' ? 'bg-gray-100 text-gray-600' : 'bg-accent-100 text-accent-700'
                    }`}>
                      {name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{name}</p>
                      <p className="text-xs text-gray-400">{entries.length} {entries.length === 1 ? 'payment' : 'payments'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className={`font-bold text-lg ${tab === 'sent' ? 'text-gray-900' : 'text-accent-600'}`}>${total.toFixed(2)}</span>
                    <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={open ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
                    </svg>
                  </div>
                </button>

                {open && (
                  <div className="border-t border-gray-100 divide-y divide-gray-50">
                    {entries.map(p => (
                      <div key={p.id} className="flex items-center justify-between px-4 py-3 gap-4">
                        <div className="min-w-0 flex-1">
                          {p.receiptId && receiptLabel[p.receiptId] ? (
                            <Link to={`/receipt/${p.receiptId}`} className="text-sm font-medium text-gray-800 hover:text-accent-600 hover:underline truncate block">
                              {receiptLabel[p.receiptId]}
                            </Link>
                          ) : (
                            <p className="text-sm font-medium text-gray-800 truncate">{p.note && !p.imported_from_settlement ? p.note : 'Payment'}</p>
                          )}
                          <p className="text-xs text-gray-400 mt-0.5">
                            {fmtDate(p.paidAt)}
                            {p.note && p.receiptId && !p.imported_from_settlement && <> · {p.note}</>}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-sm font-semibold text-gray-900">${Number(p.amount).toFixed(2)}</span>
                          <button onClick={() => remove(p)} className="text-gray-300 hover:text-red-400 transition" title="Remove this payment" aria-label="Remove this payment">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
