import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useGroup } from '../lib/group.jsx'
import { useBalances } from '../lib/useBalances.js'
import { recordPayment, deletePayment } from '../lib/db.js'
import { useDialog } from '../lib/useDialog.jsx'
import SettleUpDialog from '../components/SettleUpDialog.jsx'

const fmtShort = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
const fmtPaidAt = ts => ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null

// "3 receipts ▾" under a person's name, so it's clear the row expands
function ReceiptCountToggle({ count, expanded }) {
  return (
    <p className="flex items-center gap-0.5 text-xs text-gray-500 mt-0.5">
      {expanded ? 'Hide receipts' : `${count} receipt${count === 1 ? '' : 's'}`}
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d={expanded ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
      </svg>
    </p>
  )
}

// One person's balance with you: name, total, and (expanded) the receipts
// still unpaid. Open amounts always add up to the total.
function PersonBalance({ entry, expanded, onToggle, onSettle, onMarkReceipt, busy }) {
  const count = entry.open.length + (entry.fromPayments > 0 ? 1 : 0)
  return (
    <li className="border border-gray-100 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 transition cursor-pointer" onClick={onToggle}>
        <div className="min-w-0">
          <p className="font-medium text-gray-900">{entry.person}</p>
          <ReceiptCountToggle count={count} expanded={expanded} />
        </div>
        <div className="flex items-center gap-2.5">
          <span className={`font-semibold ${entry.iOwe ? 'text-amber-600' : 'text-gray-900'}`}>${entry.amount.toFixed(2)}</span>
          <button
            onClick={e => { e.stopPropagation(); onSettle() }}
            disabled={busy}
            className={`text-xs px-2 py-0.5 rounded-md transition disabled:opacity-50 font-medium ${entry.iOwe
              ? 'bg-accent-600 text-white hover:bg-accent-700'
              : 'border border-accent-200 text-accent-600 hover:bg-accent-50'}`}
          >
            {entry.iOwe ? 'Mark sent' : 'Mark received'}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-gray-100 px-3 py-2 space-y-1.5">
          {entry.open.map(o => (
            <div key={o.receiptId} className="flex items-center justify-between text-sm gap-2">
              <div className="min-w-0">
                <Link to={`/receipt/${o.receiptId}`} className="text-gray-700 hover:underline">{o.label}</Link>
                <span className="text-gray-400 text-xs ml-1.5">{fmtShort(o.date)}</span>
                {o.remaining < o.cents && <span className="text-gray-400 text-xs ml-1.5">(${(o.cents / 100).toFixed(2)} total, partly paid)</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-gray-900">${(o.remaining / 100).toFixed(2)}</span>
                {entry.iOwe && (
                  <button onClick={() => onMarkReceipt(o)} disabled={busy} className="text-xs px-2 py-0.5 border border-accent-200 text-accent-600 rounded-md hover:bg-accent-50 transition disabled:opacity-50">Mark sent</button>
                )}
              </div>
            </div>
          ))}
          {entry.fromPayments > 0 && (
            <div className="flex items-center justify-between text-sm gap-2">
              <span className="text-gray-700">Overpaid earlier <span className="text-gray-400 text-xs">(from payments, not a receipt)</span></span>
              <span className="text-gray-900 shrink-0">${entry.fromPayments.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function BalanceSection({ title, total, totalClass, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-800">{title}</h2>
        <span className={`text-sm font-semibold ${totalClass}`}>${total.toFixed(2)}</span>
      </div>
      <ul className="space-y-1.5 select-none">{children}</ul>
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
  const { group, myName, idOf } = useGroup()
  const { loading, data, balances, reload } = useBalances()
  const { confirm, showAlert, DialogUI } = useDialog()
  const [busy, setBusy] = useState(false)
  const [settle, setSettle] = useState(null) // { from, to, amount, title }
  const [expandedPeople, setExpandedPeople] = useState(new Set())

  if (loading) return <div className="max-w-2xl mx-auto p-8 text-gray-400">Loading…</div>

  const myBalances = myName ? balances.forPerson(myName).sort((a, b) => b.amount - a.amount) : []
  const iOweEntries = myBalances.filter(e => e.iOwe)
  const owedToMeEntries = myBalances.filter(e => !e.iOwe)
  const iOweTotal = iOweEntries.reduce((s, e) => s + e.amount, 0)
  const owedToMeTotal = owedToMeEntries.reduce((s, e) => s + e.amount, 0)

  function toggleExpanded(key) {
    setExpandedPeople(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
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

  async function removePayment(p) {
    if (!await confirm(`$${Number(p.amount).toFixed(2)} from ${p.from} to ${p.to} will be removed and the balance goes back up. This is recorded in the history.`, {
      title: 'Remove this payment?', confirmLabel: 'Remove', danger: true,
    })) return
    await deletePayment(p.id)
    reload()
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-8 space-y-4">
      {DialogUI}
      {settle && (
        <SettleUpDialog
          {...settle}
          onClose={() => setSettle(null)}
          onSave={async ({ amount, note }) => { await savePayment({ ...settle, amount, note }); setSettle(null) }}
        />
      )}

      <h1 className="text-2xl font-bold text-gray-900">Balances</h1>

      {iOweEntries.length > 0 && (
        <BalanceSection title="People you owe" total={iOweTotal} totalClass="text-amber-600">
          {iOweEntries.map(entry => (
            <PersonBalance
              key={entry.person}
              entry={entry}
              expanded={expandedPeople.has(`owe-${entry.person}`)}
              onToggle={() => toggleExpanded(`owe-${entry.person}`)}
              onSettle={() => openSettle(entry)}
              onMarkReceipt={open => markReceiptPaid(entry, open)}
              busy={busy}
            />
          ))}
        </BalanceSection>
      )}

      {owedToMeEntries.length > 0 && (
        <BalanceSection title="People who owe you" total={owedToMeTotal} totalClass="text-accent-600">
          {owedToMeEntries.map(entry => (
            <PersonBalance
              key={entry.person}
              entry={entry}
              expanded={expandedPeople.has(entry.person)}
              onToggle={() => toggleExpanded(entry.person)}
              onSettle={() => openSettle(entry)}
              busy={busy}
            />
          ))}
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
