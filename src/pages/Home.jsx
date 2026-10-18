import { Link } from 'react-router-dom'
import { version as buildVersion } from '../buildVersion.json'
import { useGroup } from '../lib/group.jsx'
import { useBalances } from '../lib/useBalances.js'
import { checkedInByReceipt, receiptsToCheckOff } from '../lib/receiptStatus.js'
import BalanceRows from '../components/BalanceRows.jsx'
import LoadError from '../components/LoadError.jsx'

// Home = what needs you: receipts to check off and where your balances stand.
// Browsing receipts lives on /receipts, settling up on /balances.
export default function Home() {
  const { myName } = useGroup()
  const { loading, error, data, balances, reload } = useBalances()

  if (error && !data) return <LoadError onRetry={reload} />
  if (loading) return <div className="max-w-2xl mx-auto p-8 text-gray-400">Loading…</div>

  const unchecked = receiptsToCheckOff(data, checkedInByReceipt(data), myName)
    .sort((a, b) => b.receipt_date.localeCompare(a.receipt_date))
  const myBalances = myName ? balances.forPerson(myName) : []
  const iOweTotal = myBalances.filter(e => e.iOwe).reduce((s, e) => s + e.amount, 0)
  const owedToMeTotal = myBalances.filter(e => !e.iOwe).reduce((s, e) => s + e.amount, 0)
  const caughtUp = unchecked.length === 0 && myBalances.length === 0

  const sortedBalances = [...myBalances].sort((a, b) => b.iOwe - a.iOwe || b.amount - a.amount)

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-8 space-y-4">

      {/* Receipts to check off */}
      {unchecked.length > 0 && (
        <section className="bg-white border border-amber-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-100">
            <h2 className="font-semibold text-amber-800">
              {unchecked.length === 1 ? '1 receipt to check off' : `${unchecked.length} receipts to check off`}
            </h2>
          </div>
          <ul className="divide-y divide-gray-100">
            {unchecked.map(r => {
              const date = new Date(r.receipt_date + 'T12:00:00')
              return (
                <li key={r.id}>
                  <Link to={`/receipt/${r.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0 bg-amber-400" />
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{r.store_name || 'Receipt'}</p>
                        <p className="text-xs text-gray-400">
                          {date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · Paid by {r.paid_by}
                        </p>
                      </div>
                    </div>
                    <span className="text-gray-300 shrink-0 ml-3">›</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Where you stand: who you owe and who owes you */}
      {myBalances.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-2 divide-x divide-gray-100 border-b border-gray-100">
            <div className="px-4 py-3.5">
              <p className="text-xs font-medium text-gray-400">You owe</p>
              <p className={`text-2xl font-bold ${iOweTotal > 0 ? 'text-amber-600' : 'text-gray-300'}`}>${iOweTotal.toFixed(2)}</p>
            </div>
            <div className="px-4 py-3.5">
              <p className="text-xs font-medium text-gray-400">You're owed</p>
              <p className={`text-2xl font-bold ${owedToMeTotal > 0 ? 'text-accent-600' : 'text-gray-300'}`}>${owedToMeTotal.toFixed(2)}</p>
            </div>
          </div>
          <div className="p-2">
            <BalanceRows entries={sortedBalances} reload={reload} showDirection />
          </div>
        </section>
      )}

      {/* All clear */}
      {caughtUp && (
        <div className="py-16 text-center">
          <p className="text-3xl mb-3">🎉</p>
          <p className="font-semibold text-gray-800 text-lg">You're all caught up!</p>
          <p className="text-sm text-gray-400 mt-1">No receipts to check off and no outstanding debts.</p>
          <Link to="/receipts" className="inline-block mt-4 text-sm text-accent-600 hover:text-accent-700 font-medium transition">
            Browse receipts →
          </Link>
        </div>
      )}

      <p className="pt-4 text-center text-xs text-gray-300">v{buildVersion}</p>
    </div>
  )
}
