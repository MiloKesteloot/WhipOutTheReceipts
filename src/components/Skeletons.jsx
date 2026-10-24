import BackButton from './BackButton.jsx'
import TornPaper from './TornPaper.jsx'
import { ChevronRight, LockIcon } from './Icons.jsx'
import { ReceiptCalendar } from './ReceiptViews.jsx'
import { getStoreLogo } from '../lib/storeLogo.js'
import { getItemEmoji } from '../lib/itemEmoji.js'
import { CATEGORIES } from '../config.js'
import { money, choiceChip } from '../lib/ui.js'

// Loading skeletons: each page's layout with gray bars where its data goes,
// so the page fills in instead of jumping from a spinner. Labels that don't
// depend on data ("Balances", "You owe") are real text. Each mirrors its
// page's markup, so a layout change there should be made here too (press 7
// in dev to compare, see lib/skeletonPreview.js).

function Bone({ className = '' }) {
  return <div className={`bg-gray-200 motion-safe:animate-pulse ${className}`} />
}

// A bar the height of one line of text at that size (so rows keep their height)
const LINE_HEIGHT = { xs: 'h-4', sm: 'h-5', base: 'h-6', lg: 'h-7', xl: 'h-7', '2xl': 'h-8' }
function Line({ size = 'base', className = '' }) {
  return (
    <div className={`flex items-center ${LINE_HEIGHT[size]} ${className}`}>
      <Bone className="h-[60%] w-full rounded" />
    </div>
  )
}

function Status({ className, children }) {
  return <div className={className} role="status" aria-label="Loading">{children}</div>
}

// Varied widths, so rows look like different names and not a grid
const NAME_WIDTHS = ['w-32', 'w-24', 'w-40', 'w-28', 'w-36', 'w-20', 'w-32', 'w-28']

// A person's row in BalanceRows: name, "N receipts ▾", amount, settle button
function PersonRowSkeleton({ i }) {
  return (
    <li className="border border-gray-100 rounded-lg flex items-center justify-between gap-2 px-3 py-2.5">
      <div className="min-w-0">
        <Line className={NAME_WIDTHS[i]} />
        <Line size="xs" className="w-20 mt-0.5" />
      </div>
      <div className="flex items-center gap-2.5 shrink-0">
        <Line className="w-14" />
        <Bone className="h-9 sm:h-8 min-w-[7.5rem] rounded-lg" />
      </div>
    </li>
  )
}

// Home: a "receipts to check off" box and your balances
export function HomeSkeleton() {
  return (
    <Status className="max-w-2xl mx-auto px-4 pt-4 pb-8 space-y-4">
      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
          <Line className="w-40" />
        </div>
        <ul className="divide-y divide-gray-100">
          {[0, 1].map(i => (
            <li key={i} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <Bone className="w-6 h-6 rounded shrink-0" />
                <div className="min-w-0">
                  <Line className={NAME_WIDTHS[i]} />
                  <Line size="xs" className="w-40" />
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-200 ml-3" />
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-gray-100 border-b border-gray-100">
          {['You owe', "You're owed"].map(label => (
            <div key={label} className="px-4 py-3.5">
              <p className="text-xs font-medium text-gray-400">{label}</p>
              <Line size="2xl" className="w-24" />
            </div>
          ))}
        </div>
        <ul className="p-2 space-y-1.5">
          {[0, 1].map(i => <PersonRowSkeleton key={i} i={i + 2} />)}
        </ul>
      </section>
    </Status>
  )
}

// Receipts tab: the view that's picked. The calendar is the real one (its
// days don't need data), just without receipts and not tappable.
export function ReceiptsSkeleton({ view }) {
  if (view === 'calendar') {
    return (
      <Status className="pointer-events-none motion-safe:animate-pulse">
        <ReceiptCalendar receipts={[]} checkedIn={{}} totals={{}} />
      </Status>
    )
  }
  if (view === 'days') {
    return (
      <Status className="space-y-6">
        {[2, 1, 1].map((count, day) => (
          <div key={day}>
            <div className="flex items-center justify-between mb-2">
              <Line size="sm" className="w-44" />
              <Line size="sm" className="w-14" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: count }, (_, i) => (
                <div key={i} className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Bone className="w-6 h-6 rounded shrink-0" />
                    <div className="min-w-0">
                      <Line className={NAME_WIDTHS[day * 2 + i]} />
                      {/* The newest receipts are usually still waiting on someone */}
                      {day === 0 && <Line size="xs" className="w-36" />}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <Line size="sm" className="w-14" />
                    <ChevronRight className="w-4 h-4 text-gray-200" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Status>
    )
  }
  return (
    <Status className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm divide-y divide-gray-100">
      {NAME_WIDTHS.map((w, i) => (
        <div key={i} className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <Bone className="w-6 h-6 rounded shrink-0" />
            <div className="min-w-0">
              <Line className={w} />
              <Line size="xs" className="w-24" />
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0 ml-3">
            <Line size="sm" className="w-14" />
            <ChevronRight className="w-4 h-4 text-gray-200" />
          </div>
        </div>
      ))}
    </Status>
  )
}

// A receipt: header, members, the items on torn paper, your running total.
// Back works while it loads. With `preview` (what the Receipts tab already
// loaded for it, see ReceiptDetail), the header and items are the real ones,
// laid out as on the page; only who claimed what and your total are bars.
export function ReceiptDetailSkeleton({ onBack, preview }) {
  return (
    <Status className="max-w-xl mx-auto p-4 py-8">
      <div className="flex items-center justify-between mb-2">
        <BackButton onClick={onBack} className="h-9" />
        <div className="flex gap-1.5 shrink-0">
          {[0, 1, 2].map(i => <div key={i} className="w-9 h-9 border border-gray-200 rounded-lg" />)}
        </div>
      </div>
      {preview ? <ReceiptPreview {...preview} /> : <ReceiptBones />}
    </Status>
  )
}

function ReceiptBones() {
  // Every item has a second line: who claimed it, or that nobody has
  const items = [['w-40', 'w-20'], ['w-28', 'w-48'], ['w-48', 'w-16'], ['w-32', 'w-24'], ['w-24', 'w-48'], ['w-36', 'w-20']]
  return (
    <>
      <div className="mb-1">
        <Line size="2xl" className="w-48" />
        <Line size="sm" className="w-44 mt-0.5" />
        <Line size="sm" className="w-28 mt-0.5" />
      </div>
      {/* h-6: the page's small text sits in a normal-size line there */}
      <div className="mt-3 mb-4 h-6 flex items-center">
        <Line size="sm" className="w-56" />
      </div>

      <TornPaper className="mb-6">
        <ul className="tear-rows divide-y divide-gray-100">
          {items.map(([name, who], i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3">
              <Bone className="h-4 w-4 rounded shrink-0" />
              <div className="flex-1 min-w-0">
                <Line size="sm" className={name} />
                <Line size="xs" className={who} />
              </div>
              <Line size="sm" className="w-12 shrink-0" />
            </li>
          ))}
        </ul>
      </TornPaper>

      <RunningTotalBones />
    </>
  )
}

function RunningTotalBones() {
  return (
    <div className="sticky bottom-above-tabbar sm:bottom-4">
      <div className="bg-white border border-gray-200 shadow-lg rounded-2xl px-4 py-3 flex items-center justify-between">
        <div>
          <Line size="xs" className="w-28" />
          <Line size="xl" className="w-20" />
        </div>
        <Bone className="h-10 w-36 rounded-xl" />
      </div>
    </div>
  )
}

// The receipt page's header and item list (same markup), from cached data
function ReceiptPreview({ receipt, items, meals, waitingOn, waitingGuests, checkingOffFor, showTotal }) {
  const logo = getStoreLogo(receipt.store_name)
  const ungrouped = items.filter(i => !i.meal_id)
  const t = Number(receipt.tax) || 0
  const ti = Number(receipt.tip) || 0
  const f = Number(receipt.fees) || 0
  const extras = [t && `Tax ${money(t)}`, ti && `Tip ${money(ti)}`, f && `Fees ${money(f)}`].filter(Boolean)
  return (
    <>
      <div className="mb-1">
        <div className="flex items-center gap-2 flex-wrap">
          {logo && <img src={logo} alt="" width={24} height={24} className="w-6 h-6 rounded" />}
          <h1 className="text-2xl font-bold text-gray-900">{receipt.store_name}</h1>
          {receipt.category && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              CATEGORIES.find(c => c.label === receipt.category)?.color || 'bg-gray-100 text-gray-600'
            }`}>
              {receipt.category}
            </span>
          )}
        </div>
        {receipt.receipt_date && (
          <p className="text-sm text-gray-400 mt-0.5">
            {new Date(receipt.receipt_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        )}
        <p className="text-sm text-gray-500 mt-0.5">Paid by {receipt.paid_by}</p>
      </div>
      <div className="mt-3 mb-4">
        <span className="text-sm text-gray-500">Members: {(receipt.members || []).join(', ') || 'none'}</span>
      </div>

      {waitingOn && (
        <div className="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="shrink-0">Still waiting on:</span>
            <span className="font-medium">{waitingOn}</span>
          </div>
          {waitingGuests.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {waitingGuests.map(name => (
                <span key={name} className="px-2.5 py-1 text-xs font-medium bg-white border border-amber-200 rounded-lg">Copy {name}'s link</span>
              ))}
            </div>
          )}
        </div>
      )}

      {checkingOffFor && (
        <div className="mb-3 flex items-center gap-2 flex-wrap text-sm">
          <span className="text-gray-500">Checking off for:</span>
          {checkingOffFor.map((label, i) => <span key={label} className={choiceChip(i === 0)}>{label}</span>)}
        </div>
      )}

      {items.length === 0 ? (
        <div className="py-8 flex flex-col items-center">
          <div className="flex flex-col items-center gap-3 w-full max-w-xs p-8 border-2 border-dashed border-gray-200 rounded-2xl text-gray-400">
            <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-base font-medium">Add items</span>
          </div>
        </div>
      ) : (
        <TornPaper className="mb-6">
          <ul className="tear-rows divide-y divide-gray-100">
            {ungrouped.map((item, i) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                <Bone className="h-4 w-4 rounded shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {item.name}
                    {getItemEmoji(item.name) && <span className="ml-1.5">{getItemEmoji(item.name)}</span>}
                    {item.always_split && <LockIcon className="w-3.5 h-3.5 text-gray-400 inline ml-1.5 -mt-0.5" />}
                  </p>
                  <Line size="xs" className={['w-20', 'w-32', 'w-16', 'w-24'][i % 4]} />
                </div>
                <span className="text-sm font-medium text-gray-700 shrink-0 tabular-nums">{money(item.price)}</span>
              </li>
            ))}
            {meals.map(meal => {
              const mealItems = items.filter(i => i.meal_id === meal.id)
              const fee = Number(meal.fee) || 0
              return (
                <li key={meal.id} className="flex items-center gap-3 px-4 py-3 bg-gray-50">
                  <Bone className="h-4 w-4 rounded shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-700">{meal.name}</p>
                    <p className="text-xs text-gray-400">
                      {mealItems.length} item{mealItems.length !== 1 ? 's' : ''}
                      {fee > 0 && ` · includes ${money(fee)} fee`}
                    </p>
                  </div>
                  <span className="text-sm font-medium text-gray-700 shrink-0 tabular-nums">
                    {money(mealItems.reduce((s, i) => s + Number(i.price), 0) + fee)}
                  </span>
                  <span className="text-gray-400 px-1 shrink-0" aria-hidden="true">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </span>
                </li>
              )
            })}
            {extras.length > 0 && (
              <li className="flex items-center gap-3 px-4 py-3 bg-gray-50/60">
                <input type="checkbox" checked readOnly disabled className="h-4 w-4 rounded accent-accent-600 opacity-40" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-400 truncate">
                    {extras.join(' · ')}
                    <LockIcon className="w-3.5 h-3.5 text-gray-400 inline ml-1.5 -mt-0.5" />
                  </p>
                  <p className="text-xs text-gray-300">Distributed proportionally to what you bought</p>
                </div>
                <span className="text-sm font-medium text-gray-400 shrink-0 tabular-nums">{money(t + ti + f)}</span>
              </li>
            )}
          </ul>
        </TornPaper>
      )}

      {showTotal && <RunningTotalBones />}
    </>
  )
}

// Balances: one section of people, then payment history
export function BalancesSkeleton() {
  return (
    <Status className="max-w-2xl mx-auto px-4 pt-4 pb-8 space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Balances</h1>

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <Line className="w-32" />
          <Line size="sm" className="w-14" />
        </div>
        <ul className="space-y-1.5">
          {[0, 1].map(i => <PersonRowSkeleton key={i} i={i} />)}
        </ul>
      </div>

      <div className="pt-4">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Payment history</h2>
        <div className="grid grid-cols-2 gap-3 mb-4">
          {['You sent', 'You received'].map(label => (
            <div key={label} className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">{label}</p>
              <Line size="2xl" className="w-24" />
              <Line size="xs" className="w-16 mt-0.5" />
            </div>
          ))}
        </div>
        <Bone className="h-9 w-56 rounded-lg mb-4" />
        <ul className="space-y-2">
          {[0, 1, 2].map(i => (
            <li key={i} className="bg-white border border-gray-200 rounded-xl flex items-center justify-between px-4 py-3.5">
              <div className="flex items-center gap-3">
                <Bone className="w-9 h-9 rounded-full shrink-0" />
                <div>
                  <Line className={NAME_WIDTHS[i + 3]} />
                  <Line size="xs" className="w-20" />
                </div>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <Line size="lg" className="w-16" />
                <ChevronRight className="w-4 h-4 text-gray-200 rotate-90" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Status>
  )
}
