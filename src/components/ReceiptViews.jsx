import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatWaitingOn } from '../lib/group.jsx'
import { waitingOn } from '../lib/receiptStatus.js'

// Calendar / Days / list views of a group's receipts (the Receipts tab).
// Each takes already-filtered receipts plus checked-in and totals maps.

const CAL_MONTH_KEY = 'receipts-calendar-month'

const fmtDate = d => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')

function EmptyState() {
  return <div className="text-center py-16 text-gray-400 text-sm">No receipts yet.</div>
}

// Opens when a calendar day has 2+ receipts
function DayPicker({ day, onClose }) {
  const navigate = useNavigate()
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <h2 className="font-semibold text-gray-900 text-lg mb-0.5">
          {day.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </h2>
        <p className="text-sm text-gray-400 mb-4">Choose one</p>
        <ul className="space-y-2 mb-4">
          {day.items.map(item => (
            <li key={item.id}>
              <button
                onClick={() => { onClose(); navigate(item.url) }}
                className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-accent-300 hover:bg-accent-50 transition text-sm font-medium text-gray-800"
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
        <button
          onClick={() => { onClose(); navigate(`/receipt/new?date=${fmtDate(day.date)}`) }}
          className="w-full py-2 border border-dashed border-gray-300 text-sm text-gray-500 rounded-xl hover:border-accent-400 hover:text-accent-600 transition"
        >
          + Add another receipt
        </button>
      </div>
    </div>
  )
}

function PhoneDayStores({ receipts, checkedIn }) {
  if (!receipts.length) return null
  const isWaiting = r => waitingOn(r, checkedIn).length > 0
  const ordered = [...receipts.filter(isWaiting), ...receipts.filter(r => !isWaiting(r))]
  const shown = ordered.length > 2 ? ordered.slice(0, 1) : ordered
  const hidden = ordered.slice(shown.length)
  const line = waiting => `text-xs truncate ${waiting ? 'font-semibold text-amber-600' : 'text-gray-600'}`
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <button onClick={() => shiftMonth(-1)} aria-label="Previous month" className="p-2 hover:bg-gray-100 rounded-lg transition text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-800">
              {firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </h2>
            {!isCurrentMonth && (
              <button
                onClick={() => setCalMonth({ year: now.getFullYear(), month: now.getMonth() })}
                className="text-xs text-accent-600 hover:text-accent-700 font-medium border border-accent-300 hover:border-accent-400 px-2 py-0.5 rounded-md transition"
              >
                ↩ Jump to today
              </button>
            )}
          </div>
          <button onClick={() => shiftMonth(1)} aria-label="Next month" className="p-2 hover:bg-gray-100 rounded-lg transition text-gray-400 hover:text-gray-600">
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
                className={`relative h-[94px] overflow-hidden sm:h-auto sm:overflow-visible sm:min-h-28 px-1 py-1.5 sm:p-2.5 transition-colors group cursor-pointer hover:bg-gray-50/80 select-none ${
                  !isCurrent ? 'bg-gray-50/60' : ''
                } ${isToday ? 'ring-2 ring-inset ring-accent-600' : ''}`}
              >
                {/* Phones: the day's total goes under the date (no room beside it) */}
                <div className="flex flex-col items-start sm:flex-row sm:justify-between mb-1 sm:mb-2">
                  <div className={`text-sm font-semibold w-7 h-7 flex items-center justify-center rounded-full leading-none ${
                    isToday ? 'bg-accent-600 text-white' : isCurrent ? 'text-gray-700' : 'text-gray-300'
                  }`}>
                    {date.getDate()}
                  </div>
                  {dayTotal > 0 && isCurrent && (
                    <span className="text-[10px] sm:text-xs font-semibold text-accent-600 leading-tight mt-0.5 sm:mt-0">${dayTotal.toFixed(2)}</span>
                  )}
                </div>
                {/* Desktop: every receipt, with a dot (amber = waiting on someone) */}
                <div className="hidden sm:block space-y-1">
                  {dayReceipts.map(receipt => (
                    <div key={receipt.id} className="flex items-center gap-1.5 text-xs text-gray-600">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${waitingOn(receipt, checkedIn).length > 0 ? 'bg-amber-400' : 'bg-accent-500'}`} />
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

export function ReceiptDays({ receipts, checkedIn, totals, myName }) {
  const navigate = useNavigate()
  const byDate = {}
  for (const r of receipts) (byDate[r.receipt_date] ||= []).push(r)
  const sortedDays = Object.keys(byDate).sort((a, b) => b.localeCompare(a))
  if (sortedDays.length === 0) return <EmptyState />

  return (
    <div className="space-y-6">
      {sortedDays.map(dateKey => {
        const date = new Date(dateKey + 'T12:00:00')
        const dayLabel = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        const dayReceipts = byDate[dateKey]
        const dayTotal = dayReceipts.reduce((s, r) => s + (totals[r.id] || 0), 0)
        return (
          <div key={dateKey}>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{dayLabel}</h3>
              {dayTotal > 0 && <span className="text-sm font-semibold text-accent-600">${dayTotal.toFixed(2)}</span>}
            </div>
            <div className="space-y-2">
              {dayReceipts.map(r => {
                const waiting = waitingOn(r, checkedIn)
                const total = totals[r.id] || 0
                return (
                  <button
                    key={r.id}
                    onClick={() => navigate(`/receipt/${r.id}`)}
                    className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-accent-300 hover:shadow-sm transition text-left select-none"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${waiting.length > 0 ? 'bg-amber-400' : 'bg-accent-500'}`} />
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{r.store_name || 'Receipt'}</p>
                        {waiting.length > 0 && (
                          <p className="text-xs text-amber-600">Waiting on {formatWaitingOn(waiting, myName)}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      {total > 0 && <span className="text-sm font-semibold text-gray-700">${total.toFixed(2)}</span>}
                      <span className="text-gray-300">›</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function ReceiptList({ receipts, checkedIn, totals, myName }) {
  const navigate = useNavigate()
  const sorted = [...receipts].sort((a, b) => b.receipt_date.localeCompare(a.receipt_date))
  if (sorted.length === 0) return <EmptyState />

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm divide-y divide-gray-100 select-none">
      {sorted.map(r => {
        const waiting = waitingOn(r, checkedIn)
        const total = totals[r.id] || 0
        const date = new Date(r.receipt_date + 'T12:00:00')
        return (
          <button
            key={r.id}
            onClick={() => navigate(`/receipt/${r.id}`)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition text-left"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${waiting.length > 0 ? 'bg-amber-400' : 'bg-accent-500'}`} />
              <div className="min-w-0">
                <p className="font-medium text-gray-900 truncate">{r.store_name || 'Receipt'}</p>
                <p className="text-xs text-gray-400">
                  {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {waiting.length > 0 && <span className="text-amber-600 ml-2">· Waiting on {formatWaitingOn(waiting, myName)}</span>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-3">
              {total > 0 && <span className="text-sm font-semibold text-gray-700">${total.toFixed(2)}</span>}
              <span className="text-gray-300">›</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
