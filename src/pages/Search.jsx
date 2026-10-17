import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  useSearchData, searchAll, addRecentSearch, receiptLink, MIN_QUERY_LENGTH,
  RecentSearches, ItemRow, ReceiptRow, ResultSection, SearchInput,
} from '../lib/search.jsx'
import { useGroup } from '../lib/group.jsx'

const PAGE_SIZE = 30

function ShowMore({ remaining, onClick }) {
  if (remaining <= 0) return null
  return (
    <button onClick={onClick} className="w-full px-4 py-3 text-sm font-medium text-accent-600 hover:bg-gray-50 transition">
      Show more ({remaining})
    </button>
  )
}

export default function Search() {
  const [params, setParams] = useSearchParams()
  const [input, setInput] = useState(params.get('q') || '')
  const [itemLimit, setItemLimit] = useState(PAGE_SIZE)
  const [receiptLimit, setReceiptLimit] = useState(PAGE_SIZE)
  const data = useSearchData()
  const navigate = useNavigate()
  const { myName } = useGroup()
  const query = params.get('q') || ''

  // Keep input in sync when the URL changes (e.g. nav dropdown "See all")
  useEffect(() => { setInput(query) }, [query])

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

  const { items, receipts, terms } = searchAll(data, query)
  const searching = query.trim().length >= MIN_QUERY_LENGTH

  function open(path) {
    addRecentSearch(query)
    navigate(path)
  }

  function pick(q) {
    setInput(q)
    setParams({ q }, { replace: true })
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <SearchInput
        value={input}
        onChange={setInput}
        onKeyDown={e => { if (e.key === 'Enter') { addRecentSearch(input); e.currentTarget.blur() } }}
      />

      {!searching ? (
        <RecentSearches onPick={pick} />
      ) : !data ? (
        <p className="text-center py-12 text-sm text-gray-400">Loading…</p>
      ) : (
        <>
          <ResultSection
            title="Items"
            count={items.length}
            footer={<ShowMore remaining={items.length - itemLimit} onClick={() => setItemLimit(l => l + PAGE_SIZE)} />}
          >
            {items.slice(0, itemLimit).map(item => (
              <ItemRow key={item.id} item={item} terms={terms} myName={myName} onClick={() => open(receiptLink(item.receipt))} />
            ))}
          </ResultSection>

          <ResultSection
            title="Receipts"
            count={receipts.length}
            footer={<ShowMore remaining={receipts.length - receiptLimit} onClick={() => setReceiptLimit(l => l + PAGE_SIZE)} />}
          >
            {receipts.slice(0, receiptLimit).map(r => (
              <ReceiptRow key={r.id} receipt={r} terms={terms} onClick={() => open(receiptLink(r))} />
            ))}
          </ResultSection>

          {items.length === 0 && receipts.length === 0 && (
            <p className="text-center py-8 text-sm text-gray-400">Nothing matching "{query.trim()}"</p>
          )}
        </>
      )}
    </div>
  )
}
