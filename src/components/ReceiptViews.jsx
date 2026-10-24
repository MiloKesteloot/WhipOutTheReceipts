import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { formatWaitingOn } from '../lib/group.jsx'
import { waitingOn } from '../lib/receiptStatus.js'
import Modal from './Modal.jsx'
import { ChevronRight } from './Icons.jsx'
import { money } from '../lib/ui.js'
import { getStoreLogo } from '../lib/storeLogo.js'

// Calendar / Days / list views of a group's receipts (the Receipts tab).
// Each takes already-filtered receipts plus checked-in and totals maps.

const CAL_MONTH_KEY = 'receipts-calendar-month'

const fmtDate = d => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')

// Nothing to show: either there are no receipts, or "Mine" hides them all
function EmptyState({ hiddenCount, onShowAll }) {
  if (hiddenCount > 0) {
    return (
      <div className="text-center py-16 text-gray-400 text-sm">
        <p>No receipts you're on.</p>
        <button onClick={onShowAll} className="mt-2 text-accent-600 font-medium hover:text-accent-700">
          Show all {hiddenCount} receipt{hiddenCount === 1 ? '' : 's'}
        </button>
      </div>
    )
  }
  return <div className="text-center py-16 text-gray-400 text-sm">No receipts yet.</div>
}

// The store's logo, or 🧾 for a store we don't have one for
export function StoreIcon({ name, className = 'w-6 h-6 text-lg' }) {
  const logo = getStoreLogo(name)
  return logo
    ? <img src={logo} alt="" width={24} height={24} className={`${className} rounded object-contain`} />
    : <span className={`${className} flex items-center justify-center leading-none`}>🧾</span>
}

// A row's store icon, with an amber dot when it's waiting on someone
function RowStoreIcon({ name, waiting }) {
  return (
    <span className="relative shrink-0">
      <StoreIcon name={name} />
      {waiting && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-white" />}
    </span>
  )
}

// Opens when a calendar day has 2+ receipts
function DayPicker({ day, onClose }) {
  const navigate = useNavigate()

  return (
    <Modal title={day.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} onClose={onClose}>
      <p className="text-sm text-gray-400 mt-0.5 mb-4">Choose one</p>
      <ul className="space-y-2 mb-4">
        {day.items.map(item => (
          <li key={item.id}>
            <Link
              to={item.url}
              onClick={onClose}
              className="flex items-center justify-between gap-2 w-full text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-accent-300 hover:bg-accent-50 active:bg-accent-50 transition text-sm font-medium text-gray-800"
            >
              <span className="truncate">{item.label}</span>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </Link>
          </li>
        ))}
      </ul>
      <button
        onClick={() => { onClose(); navigate(`/receipt/new?date=${fmtDate(day.date)}`) }}
        className="w-full h-10 border border-dashed border-gray-300 text-sm text-gray-500 rounded-xl hover:border-accent-400 hover:text-accent-600 active:bg-gray-50 transition"
      >
        + Add another receipt
      </button>
    </Modal>
  )
}

function PhoneDayStores({ receipts, checkedIn }) {
  if (!receipts.length) return null
  const isWaiting = r => waitingOn(r, checkedIn).length > 0
  const ordered = [...receipts.filter(isWaiting), ...receipts.filter(r => !isWaiting(r))]
  const shown = ordered.length > 2 ? ordered.slice(0, 1) : ordered
  const hidden = ordered.slice(shown.length)
  const line = waiting => `text-xs truncate ${waiting ? 'font-semibold text-amber-600' : 'text-gray-600'}`

  // Any store with a logo: just icons, side by side, or two by two when
  // there are 3+ (smaller, to fit). A store without one gets its first letter.
  // Waiting receipts get an amber ring; past four, "+N".
  if (ordered.some(r => getStoreLogo(r.store_name))) {
    const tiles = ordered.length > 4 ? ordered.slice(0, 3) : ordered
    const more = ordered.length - tiles.length
    const small = ordered.length > 2
    // Square at whatever width the column gets (phones squeeze it below the
    // 1rem/1.25rem max), so a ring stays square and the logo centered
    const tile = `${small ? 'text-[9px]' : 'text-[11px]'} w-full aspect-square rounded flex items-center justify-center font-semibold leading-none`
    return (
      <div className={`sm:hidden grid gap-[3px] pl-0.5 pt-0.5 ${small ? 'grid-cols-[repeat(2,minmax(0,1rem))]' : 'grid-cols-[repeat(2,minmax(0,1.25rem))]'}`}>
        {tiles.map(r => {
          const logo = getStoreLogo(r.store_name)
          const ring = isWaiting(r) ? 'ring-2 ring-amber-400' : ''
          return logo
            ? <img key={r.id} src={logo} alt={r.store_name} width={16} height={16} className={`${tile} object-contain bg-white ${ring}`} />
            : <span key={r.id} title={r.store_name} className={`${tile} bg-gray-100 text-gray-500 ${ring}`}>{(r.store_name || '?').trim().charAt(0).toUpperCase()}</span>
        })}
        {more > 0 && <span className={`${tile} ${ordered.slice(tiles.length).some(isWaiting) ? 'text-amber-600' : 'text-gray-500'}`}>+{more}</span>}
      </div>
    )
  }
  return (
    <div className="sm:hidden space-y-0.5">
      {shown.map(r => <p key={r.id} className={line(isWaiting(r))}>{r.store_name}</p>)}
      {hidden.length > 0 && (
        <p className={`text-[10px] leading-4 whitespace-nowrap ${hidden.some(isWaiting) ? 'font-semibold text-amber-600' : 'text-gray-500'}`}>
          +{hidden.length} more
        </p>
      )}
    </div>
  )
}

export function ReceiptCalendar({ receipts, checkedIn, totals }) {
  const navigate = useNavigate()
  const [pickerDay, setPickerDay] = useState(null) // { date, items }
  // The month shown is remembered for this session, so coming back from a
  // receipt lands on the same month
  const [calMonth, setCalMonthState] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(CAL_MONTH_KEY))
      if (Number.isInteger(saved?.year) && Number.isInteger(saved?.month)) return saved
    } catch {}
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const setCalMonth = next => setCalMonthState(prev => {
    const value = typeof next === 'function' ? next(prev) : next
    try { sessionStorage.setItem(CAL_MONTH_KEY, JSON.stringify(value)) } catch {}
    return value
  })

  const now = new Date()
  const isCurrentMonth = calMonth.year === now.getFullYear() && calMonth.month === now.getMonth()
  const firstDay = new Date(calMonth.year, calMonth.month, 1)
  const daysInMonth = new Date(calMonth.year, calMonth.month + 1, 0).getDate()
  const startPad = firstDay.getDay()
  const totalCells = Math.ceil((startPad + daysInMonth) / 7) * 7
  const shiftMonth = delta => setCalMonth(prev => {
    const d = new Date(prev.year, prev.month + delta, 1)
    return { year: d.getFullYear(), month: d.getMonth() }
  })

  // Grid including overflow days from adjacent months
  const calDays = Array.from({ length: totalCells }, (_, i) => {
    const dayNum = i - startPad + 1
    return { date: new Date(calMonth.year, calMonth.month, dayNum), isCurrent: dayNum >= 1 && dayNum <= daysInMonth }
  })

  const receiptsByDate = {}
  for (const receipt of receipts) {
    const d = new Date(receipt.receipt_date + 'T12:00:00')
    ;(receiptsByDate[`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`] ||= []).push(receipt)
  }

  return (
    <>
      {pickerDay && <DayPicker day={pickerDay} onClose={() => setPickerDay(null)} />}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        {/* Header */}
        {/* Phones: tighter, and the month never wraps (the Today pill sits beside it) */}
        <div className="flex items-center justify-between gap-1 px-2 sm:px-5 py-3 sm:py-4 border-b border-gray-100">
          <button onClick={() => shiftMonth(-1)} aria-label="Previous month" className="p-2 hover:bg-gray-100 active:bg-gray-100 rounded-lg transition text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-gray-800 whitespace-nowrap">
              {firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </h2>
            {!isCurrentMonth && (
              <button
                onClick={() => setCalMonth({ year: now.getFullYear(), month: now.getMonth() })}
                className="shrink-0 whitespace-nowrap text-xs text-accent-600 hover:text-accent-700 font-medium border border-accent-300 hover:border-accent-400 active:bg-accent-50 px-2 py-1 rounded-md transition"
              >
                Today
              </button>
            )}
          </div>
          <button onClick={() => shiftMonth(1)} aria-label="Next month" className="p-2 hover:bg-gray-100 active:bg-gray-100 rounded-lg transition text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50/50">
          {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map(d => (
            <div key={d} className="text-center text-xs font-semibold text-gray-400 tracking-widest py-3">{d}</div>
          ))}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-7 divide-x divide-y divide-gray-100">
          {calDays.map(({ date, isCurrent }, i) => {
            const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
            const isToday = date.toDateString() === now.toDateString()
            const dayReceipts = receiptsByDate[key] || []
            const dayTotal = dayReceipts.reduce((s, r) => s + (totals[r.id] || 0), 0)
            const dayItems = dayReceipts.map(r => ({ id: r.id, label: r.store_name, url: `/receipt/${r.id}` }))

            function handleCellClick() {
              if (dayItems.length === 0) navigate(`/receipt/new?date=${fmtDate(date)}`)
              else if (dayItems.length === 1) navigate(dayItems[0].url)
              else setPickerDay({ date, items: dayItems })
            }

            return (
              <div
                key={`${key}-${i}`}
                onClick={handleCellClick}
                className={`relative h-[94px] overflow-hidden sm:h-auto sm:overflow-visible sm:min-h-28 px-1 py-1.5 sm:p-2.5 transition-colors group cursor-pointer hover:bg-gray-50/80 active:bg-gray-100 select-none ${
                  !isCurrent ? 'bg-gray-50/60' : ''
                } ${isToday ? 'ring-2 ring-inset ring-accent-600' : ''}`}
              >
                {/* Phones: the day's total goes under the date (no room beside it).
                    Gray, not green: green means "owed to you" elsewhere. */}
                <div className="flex flex-col items-start sm:flex-row sm:justify-between mb-1 sm:mb-2">
                  <div className={`text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full leading-none ${
                    isToday ? 'bg-accent-600 text-white' : isCurrent ? 'text-gray-700' : 'text-gray-300'
                  }`}>
                    {date.getDate()}
                  </div>
                  {dayTotal > 0 && isCurrent && (
                    <span className="text-[10px] sm:text-xs font-medium text-gray-500 tabular-nums leading-tight mt-0.5 sm:mt-0">{money(dayTotal)}</span>
                  )}
                </div>
                {/* Desktop: every receipt, with a dot (amber = waiting on someone) */}
                <div className="hidden sm:block space-y-1">
                  {dayReceipts.map(receipt => (
                    // Waiting on someone: amber, like on phones
                    <div key={receipt.id} className={`flex items-center gap-1.5 text-xs ${waitingOn(receipt, checkedIn).length > 0 ? 'font-medium text-amber-600' : 'text-gray-600'}`}>
                      {/* 🧾 is a smudge this small: a dot instead, in the icon's space */}
                      {getStoreLogo(receipt.store_name)
                        ? <StoreIcon name={receipt.store_name} className="w-3.5 h-3.5 shrink-0" />
                        : <span className="w-3.5 h-3.5 shrink-0 flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-gray-300" /></span>}
                      <span className="truncate">{receipt.store_name}</span>
                    </div>
                  ))}
                </div>
                {/* Phones: room for two lines (the square is sized for date, total
                    and two stores). Waiting receipts are bold amber and listed
                    first; three or more show one store and "+N more". */}
                <PhoneDayStores receipts={dayReceipts} checkedIn={checkedIn} />
                {/* "+" button, bottom right: on hover with a mouse, always on touch
                    screens; not on phones, where there's no room for it */}
                {isCurrent && dayItems.length >= 1 && (
                  <button
                    onClick={e => { e.stopPropagation(); navigate(`/receipt/new?date=${fmtDate(date)}`) }}
                    className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity w-5 h-5 hidden sm:flex items-center justify-center rounded-full bg-accent-100 text-accent-600 hover:bg-accent-200 text-xs font-bold leading-none pb-px"
                    title="Add another receipt"
                  >
                    +
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

export function ReceiptDays({ receipts, checkedIn, totals, myName, hiddenCount, onShowAll }) {
  const byDate = {}
  // Receipts without a date go last, under "No date"
  for (const r of receipts) (byDate[r.receipt_date || ''] ||= []).push(r)
  const sortedDays = Object.keys(byDate).sort((a, b) => b.localeCompare(a))
  if (sortedDays.length === 0) return <EmptyState hiddenCount={hiddenCount} onShowAll={onShowAll} />

  const thisYear = new Date().getFullYear()

  return (
    <div className="space-y-6">
      {sortedDays.map(dateKey => {
        // "Saturday, October 17", with the year only when it isn't this year
        const day = dateKey && new Date(dateKey + 'T12:00:00')
        const dayLabel = day
          ? day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...(day.getFullYear() !== thisYear && { year: 'numeric' }) })
          : 'No date'
        const dayReceipts = byDate[dateKey]
        const dayTotal = dayReceipts.reduce((s, r) => s + (totals[r.id] || 0), 0)
        return (
          <div key={dateKey}>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-500">{dayLabel}</h3>
              {dayTotal > 0 && <span className="text-sm font-semibold text-gray-900 tabular-nums">{money(dayTotal)}</span>}
            </div>
            <div className="space-y-2">
              {dayReceipts.map(r => {
                const waiting = waitingOn(r, checkedIn)
                const total = totals[r.id] || 0
                return (
                  <Link
                    key={r.id}
                    to={`/receipt/${r.id}`}
                    className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-accent-300 hover:shadow-sm active:bg-gray-50 transition text-left select-none"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <RowStoreIcon name={r.store_name} waiting={waiting.length > 0} />
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{r.store_name || 'Receipt'}</p>
                        {waiting.length > 0 && (
                          <p className="text-xs text-amber-600">Waiting on {formatWaitingOn(waiting, myName)}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      {total > 0 && <span className="text-sm font-semibold text-gray-700 tabular-nums">{money(total)}</span>}
                      <ChevronRight className="w-4 h-4 text-gray-300" />
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function ReceiptList({ receipts, checkedIn, totals, myName, hiddenCount, onShowAll }) {
  const sorted = [...receipts].sort((a, b) => (b.receipt_date || '').localeCompare(a.receipt_date || ''))
  if (sorted.length === 0) return <EmptyState hiddenCount={hiddenCount} onShowAll={onShowAll} />

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm divide-y divide-gray-100 select-none">
      {sorted.map(r => {
        const waiting = waitingOn(r, checkedIn)
        const total = totals[r.id] || 0
        const date = r.receipt_date
          ? new Date(r.receipt_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : 'No date'
        return (
          <Link
            key={r.id}
            to={`/receipt/${r.id}`}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 active:bg-gray-100 transition text-left"
          >
            <div className="flex items-center gap-3 min-w-0">
              <RowStoreIcon name={r.store_name} waiting={waiting.length > 0} />
              <div className="min-w-0">
                <p className="font-medium text-gray-900 truncate">{r.store_name || 'Receipt'}</p>
                <p className="text-xs text-gray-400">
                  {date}
                  {waiting.length > 0 && <span className="text-amber-600 ml-2">· Waiting on {formatWaitingOn(waiting, myName)}</span>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-3">
              {total > 0 && <span className="text-sm font-semibold text-gray-700 tabular-nums">{money(total)}</span>}
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </div>
          </Link>
        )
      })}
    </div>
  )
}
