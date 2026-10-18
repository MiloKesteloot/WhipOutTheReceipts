import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useGroup } from '../lib/group.jsx'
import { useBalances } from '../lib/useBalances.js'
import { deletePayment } from '../lib/db.js'
import { useDialog } from '../lib/useDialog.jsx'
import BalanceRows from '../components/BalanceRows.jsx'
import LoadError from '../components/LoadError.jsx'

const fmtPaidAt = ts => ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null

function BalanceSection({ title, total, totalClass, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-800">{title}</h2>
        <span className={`text-sm font-semibold ${totalClass}`}>${total.toFixed(2)}</span>
      </div>
      {children}
    </div>
  )
}

// Sent / received payments grouped by the other person, with remove
function PaymentHistory({ data, myName, onRemove }) {
  const [tab, setTab] = useState('sent')
  const [expanded, setExpanded] = useState(new Set())
  const me = myName.toLowerCase()
  const receiptLabel = Object.fromEntries(data.receipts.map(r => [r.id, r.store_name || 'Receipt']))

  function build(direction) {
    const byPerson = {}
    for (const p of data.payments) {
      const sent = p.from.toLowerCase() === me
      const received = p.to.toLowerCase() === me
      if (direction === 'sent' ? !sent : !received) continue
      ;(byPerson[sent ? p.to : p.from] ||= []).push(p)
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

  return (
    <section>
      <h2 className="text-lg font-bold text-gray-900 mb-3">Payment history</h2>

      <div className="grid grid-cols-2 gap-3 mb-4">
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

      {activeList.length === 0 ? (
        <div className="py-12 text-center text-gray-400 text-sm">
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
                            {fmtPaidAt(p.paidAt)}
                            {p.note && p.receiptId && !p.imported_from_settlement && <> · {p.note}</>}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-sm font-semibold text-gray-900">${Number(p.amount).toFixed(2)}</span>
                          <button onClick={() => onRemove(p)} className="text-gray-300 hover:text-red-400 transition" title="Remove this payment" aria-label="Remove this payment">
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
    </section>
  )
}

export default function Balances() {
  const { myName } = useGroup()
  const { loading, error, data, balances, reload } = useBalances()
  const { confirm, showAlert, DialogUI } = useDialog()

  if (error && !data) return <LoadError onRetry={reload} />
  if (loading) return <div className="max-w-2xl mx-auto p-8 text-gray-400">Loading…</div>

  const myBalances = myName ? balances.forPerson(myName).sort((a, b) => b.amount - a.amount) : []
  const iOweEntries = myBalances.filter(e => e.iOwe)
  const owedToMeEntries = myBalances.filter(e => !e.iOwe)
  const iOweTotal = iOweEntries.reduce((s, e) => s + e.amount, 0)
  const owedToMeTotal = owedToMeEntries.reduce((s, e) => s + e.amount, 0)

  async function removePayment(p) {
    if (!await confirm(`$${Number(p.amount).toFixed(2)} from ${p.from} to ${p.to} will be removed and the balance goes back up. This is recorded in the history.`, {
      title: 'Remove this payment?', confirmLabel: 'Remove', danger: true,
    })) return
    try {
      await deletePayment(p.id)
    } catch (err) {
      await showAlert(err.message, { title: 'Could not remove the payment' })
    }
    reload()
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-8 space-y-4">
      {DialogUI}

      <h1 className="text-2xl font-bold text-gray-900">Balances</h1>

      {iOweEntries.length > 0 && (
        <BalanceSection title="People you owe" total={iOweTotal} totalClass="text-amber-600">
          <BalanceRows entries={iOweEntries} reload={reload} />
        </BalanceSection>
      )}

      {owedToMeEntries.length > 0 && (
        <BalanceSection title="People who owe you" total={owedToMeTotal} totalClass="text-accent-600">
          <BalanceRows entries={owedToMeEntries} reload={reload} />
        </BalanceSection>
      )}

      {myBalances.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-6 text-center">
          <p className="font-semibold text-gray-800">You're all settled up</p>
          <p className="text-sm text-gray-400 mt-1">You don't owe anyone, and nobody owes you.</p>
        </div>
      )}

      <div className="pt-4">
        <PaymentHistory data={data} myName={myName} onRemove={removePayment} />
      </div>
    </div>
  )
}
