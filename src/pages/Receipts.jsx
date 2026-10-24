import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  useSearchData, searchAll, addRecentSearch, useRecentKey, receiptLink, MIN_QUERY_LENGTH,
  RecentSearches, ItemRow, ReceiptRow, ResultSection, SearchInput,
} from '../lib/search.jsx'
import { useGroup } from '../lib/group.jsx'
import { useBalances } from '../lib/useBalances.js'
import LoadError from '../components/LoadError.jsx'
import { PageLoading } from '../components/Loading.jsx'
import { ReceiptsSkeleton } from '../components/Skeletons.jsx'
import { useSkeletonPreview } from '../lib/skeletonPreview.js'
import { checkedInByReceipt, receiptTotals, isOnReceipt } from '../lib/receiptStatus.js'
import { ReceiptCalendar, ReceiptDays, ReceiptList } from '../components/ReceiptViews.jsx'

const PAGE_SIZE = 30
const VIEWS = [['calendar', 'Calendar'], ['days', 'Days'], ['receipts', 'Receipts']]
const VIEW_KEY = 'receipts-view'
const SHOW_ALL_KEY = 'receipts-show-all'

function savedView() {
  try {
    const v = localStorage.getItem(VIEW_KEY) || localStorage.getItem('home-view') // older key from Home
    return VIEWS.some(([key]) => key === v) ? v : 'calendar'
  } catch { return 'calendar' }
}

function ShowMore({ remaining, onClick }) {
  if (remaining <= 0) return null
  return (
    <button onClick={onClick} className="w-full px-4 py-3 text-sm font-medium text-accent-600 hover:bg-gray-50 active:bg-gray-100 transition">
      Show more ({remaining})
    </button>
  )
}

// Segmented control used for the view and Mine/All switches (one size for
// both, taller on phones so they're easy to tap)
function Segmented({ options, value, onChange }) {
  return (
    <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5 shrink-0">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-2.5 sm:px-3 py-2 sm:py-1.5 text-sm font-medium rounded-md transition-colors ${
            value === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export default function Receipts() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') || ''
  const [input, setInput] = useState(query)
  const [focused, setFocused] = useState(false)
  const [itemLimit, setItemLimit] = useState(PAGE_SIZE)
  const [receiptLimit, setReceiptLimit] = useState(PAGE_SIZE)
  const [view, setView] = useState(savedView)
  // Mine/All: the Settings default, or what you picked earlier this session
  // (so it's still set when you come Back from a receipt)
  const [showAll, setShowAllState] = useState(() => {
    try {
      const picked = sessionStorage.getItem(SHOW_ALL_KEY)
      if (picked) return picked === 'all'
    } catch {}
    return localStorage.getItem('default-show-all-trips') === '1'
  })
  const setShowAll = all => {
    try { sessionStorage.setItem(SHOW_ALL_KEY, all ? 'all' : 'mine') } catch {}
    setShowAllState(all)
  }
  const searchData = useSearchData()
  const recentKey = useRecentKey()
  const { loading, error, data, reload } = useBalances()
  const { myName } = useGroup()
  const skeletonPreview = useSkeletonPreview()

  useEffect(() => { setInput(query) }, [query])
  useEffect(() => { window.getSelection()?.removeAllRanges() }, [view])

  // Debounce typing into the URL so Back restores the last search
  useEffect(() => {
    if (input === query) return
    const t = setTimeout(() => {
      setParams(input ? { q: input } : {}, { replace: true })
      setItemLimit(PAGE_SIZE)
      setReceiptLimit(PAGE_SIZE)
    }, 200)
    return () => clearTimeout(t)
  }, [input])

  const searching = query.trim().length >= MIN_QUERY_LENGTH
  const { items, receipts, terms } = searchAll(searchData, query)

  // Opening a result (a link) remembers the search
  const rememberSearch = () => addRecentSearch(recentKey, query)

  function pick(q) {
    setInput(q)
    setParams({ q }, { replace: true })
  }

  function changeView(v) {
    try { localStorage.setItem(VIEW_KEY, v) } catch {}
    setView(v)
  }

  let viewProps = null
  if (data) {
    const shown = data.receipts.filter(r => showAll || isOnReceipt(r, myName))
    viewProps = {
      receipts: shown,
      hiddenCount: data.receipts.length - shown.length,
      onShowAll: () => setShowAll(true),
      checkedIn: checkedInByReceipt(data),
      totals: receiptTotals(data),
      myName,
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 pt-4 pb-8 space-y-4">
      <div className="max-w-2xl mx-auto">
        <SearchInput
          value={input}
          onChange={setInput}
          onKeyDown={e => { if (e.key === 'Enter') { addRecentSearch(recentKey, input); e.currentTarget.blur() } }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {/* Recent searches while the empty box is focused; mousedown keeps focus so chips can be clicked */}
        {focused && !input && (
          <div className="mt-3" onMouseDown={e => e.preventDefault()}>
            <RecentSearches onPick={pick} />
          </div>
        )}
      </div>

      {searching ? (
        <div className="max-w-2xl mx-auto space-y-6">
          {!searchData ? (
            <PageLoading />
          ) : searchData.failed ? (
            <p className="text-center py-12 text-sm text-gray-400">Couldn't load search. Check your connection and refresh the page.</p>
          ) : (
            <>
              <ResultSection
                title="Items"
                count={items.length}
                footer={<ShowMore remaining={items.length - itemLimit} onClick={() => setItemLimit(l => l + PAGE_SIZE)} />}
              >
                {items.slice(0, itemLimit).map(item => (
                  <ItemRow key={item.id} item={item} terms={terms} myName={myName} to={receiptLink(item.receipt)} onClick={rememberSearch} />
                ))}
              </ResultSection>

              <ResultSection
                title="Receipts"
                count={receipts.length}
                footer={<ShowMore remaining={receipts.length - receiptLimit} onClick={() => setReceiptLimit(l => l + PAGE_SIZE)} />}
              >
                {receipts.slice(0, receiptLimit).map(r => (
                  <ReceiptRow key={r.id} receipt={r} terms={terms} to={receiptLink(r)} onClick={rememberSearch} />
                ))}
              </ResultSection>

              {items.length === 0 && receipts.length === 0 && (
                <p className="text-center py-8 text-sm text-gray-400">Nothing matching "{query.trim()}"</p>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 select-none">
            <Segmented options={VIEWS} value={view} onChange={changeView} />
            <Segmented options={[['mine', 'Mine'], ['all', 'All']]} value={showAll ? 'all' : 'mine'} onChange={v => setShowAll(v === 'all')} />
          </div>

          {error && !data ? (
            <LoadError onRetry={reload} />
          ) : loading || skeletonPreview ? (
            <ReceiptsSkeleton view={view} />
          ) : view === 'calendar' ? (
            <ReceiptCalendar {...viewProps} />
          ) : view === 'days' ? (
            <ReceiptDays {...viewProps} />
          ) : (
            <ReceiptList {...viewProps} />
          )}
        </>
      )}
    </div>
  )
}
