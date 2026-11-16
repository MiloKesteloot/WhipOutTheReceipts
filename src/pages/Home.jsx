import { Link } from 'react-router-dom'
import { version as buildVersion } from '../buildVersion.json'
import { useGroup } from '../lib/group.jsx'
import { useBalances } from '../lib/useBalances.js'
import { checkedInByReceipt, receiptsToCheckOff, unclaimedForMe } from '../lib/receiptStatus.js'
import { claimItem, dismissItem } from '../lib/db.js'
import { invalidateSearch } from '../lib/search.jsx'
import { useDialog } from '../lib/useDialog.jsx'
import UnclaimedItems from '../components/UnclaimedItems.jsx'
import PriceNotices from '../components/PriceNotices.jsx'
import BalanceRows from '../components/BalanceRows.jsx'
import LoadError, { StaleNotice } from '../components/LoadError.jsx'
import GetStarted from '../components/GetStarted.jsx'
import { HomeSkeleton } from '../components/Skeletons.jsx'
import { useSkeletonPreview } from '../lib/skeletonPreview.js'
import { ChevronRight } from '../components/Icons.jsx'
import { StoreIcon } from '../components/ReceiptViews.jsx'
import { money } from '../lib/ui.js'

// Home = what needs you: receipts to check off and where your balances stand.
// Browsing receipts lives on /receipts, settling up on /balances.
export default function Home() {
  const { group, myName, myMember, members } = useGroup()
  const { loading, error, data, balances, reload } = useBalances()
  const { showAlert, DialogUI } = useDialog()
  const skeletonPreview = useSkeletonPreview()

  if (error && !data) return <LoadError onRetry={reload} />
  if (loading || skeletonPreview) return <HomeSkeleton />

  const unchecked = receiptsToCheckOff(data, checkedInByReceipt(data), myName)
    .sort((a, b) => (b.receipt_date || '').localeCompare(a.receipt_date || ''))
  const unclaimed = unclaimedForMe(data, myName)

  // Unread notices for me (not guests I check off for), on items and
  // receipts that are still there
  const itemById = new Map(data.items.map(i => [i.id, i]))
  const receiptById = new Map(data.receipts.map(r => [r.id, r]))
  const myNotices = (data.notices || [])
    .filter(n => n.member_id === myMember?.id && itemById.has(n.item_id) && receiptById.has(n.receipt_id))
    .map(n => ({ ...n, item: itemById.get(n.item_id), receipt: receiptById.get(n.receipt_id) }))
  const priceNotices = myNotices.filter(n => n.kind === 'price')
  // Why a receipt is back on your list: "Niko added Eggs and Juice"
  function reopenedBecause(receiptId) {
    const mine = myNotices.filter(n => n.receipt_id === receiptId && (n.kind === 'added' || n.kind === 'shared'))
    if (!mine.length) return null
    const byActor = {}
    for (const n of mine) (byActor[n.actor] ||= { added: [], shared: [] })[n.kind].push(n.item.name)
    const list = names => names.length > 2 ? `${names.length} items` : names.join(' and ')
    return Object.entries(byActor).map(([actor, { added, shared }]) => [
      added.length && `${actor} added ${list(added)}`,
      shared.length && `${actor} made ${list(shared)} split by everyone`,
    ].filter(Boolean).join(', ')).join('; ')
  }
  // An unclaimed item someone else took care of while you're here
  function explainGone(entry) {
    const claimers = data.claims.filter(c => c.item_id === entry.item.id).map(c => c.roommate)
    if (claimers.length) return `${claimers.join(' and ')} claimed it`
    if (!itemById.has(entry.item.id)) return 'It was taken off the receipt'
    return 'Taken care of'
  }

  // "It's mine" / "Not mine" on an unclaimed item, then fresh balances
  async function save(fn, entry, what) {
    try {
      await fn(myMember.id, entry.item.id)
      invalidateSearch(group.id)
      await reload()
    } catch (err) {
      await showAlert(err.message, { title: `Couldn't ${what}` })
    }
  }
  const myBalances = myName ? balances.forPerson(myName) : []
  const iOweTotal = myBalances.filter(e => e.iOwe).reduce((s, e) => s + e.amount, 0)
  const owedToMeTotal = myBalances.filter(e => !e.iOwe).reduce((s, e) => s + e.amount, 0)
  // A new group: no receipts yet, or nobody else in it yet
  const noReceipts = data.receipts.length === 0
  const alone = !members.some(m => m.active && m.id !== myMember?.id)
  const caughtUp = !noReceipts && unchecked.length === 0 && unclaimed.length === 0 && myBalances.length === 0

  const sortedBalances = [...myBalances].sort((a, b) => b.iOwe - a.iOwe || b.amount - a.amount)

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-8 space-y-4">
      {DialogUI}
      {error && <StaleNotice onRetry={reload} />}
      {(noReceipts || alone) && <GetStarted showAddReceipt={noReceipts} />}
      <PriceNotices notices={priceNotices} onSeen={reload} />

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
              const date = r.receipt_date
                ? new Date(r.receipt_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                : 'No date'
              return (
                <li key={r.id}>
                  <Link to={`/receipt/${r.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 active:bg-gray-100 transition">
                    <div className="flex items-center gap-3 min-w-0">
                      <StoreIcon name={r.store_name} className="w-6 h-6 text-lg shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{r.store_name || 'Receipt'}</p>
                        <p className="text-xs text-gray-400">
                          {date} · Paid by {r.paid_by}
                        </p>
                        {reopenedBecause(r.id) && <p className="text-xs text-amber-700" data-reopened>{reopenedBecause(r.id)}</p>}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 ml-3" />
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Items nobody claimed on finished receipts: whoever bought it, claim it */}
      <UnclaimedItems
        entries={unclaimed}
        myName={myName}
        receiptLink={r => `/receipt/${r.id}`}
        onMine={entry => save(claimItem, entry, 'claim it')}
        onNotMine={entry => save(dismissItem, entry, 'save that')}
        explainGone={explainGone}
      />

      {/* Where you stand: who you owe and who owes you */}
      {myBalances.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-2 divide-x divide-gray-100 border-b border-gray-100">
            <div className="px-4 py-3.5">
              <p className="text-xs font-medium text-gray-400">You owe</p>
              <p className={`text-2xl font-bold tabular-nums ${iOweTotal > 0 ? 'text-amber-600' : 'text-gray-300'}`}>{money(iOweTotal)}</p>
            </div>
            <div className="px-4 py-3.5">
              <p className="text-xs font-medium text-gray-400">You're owed</p>
              <p className={`text-2xl font-bold tabular-nums ${owedToMeTotal > 0 ? 'text-accent-600' : 'text-gray-300'}`}>{money(owedToMeTotal)}</p>
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
