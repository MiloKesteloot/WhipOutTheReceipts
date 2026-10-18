import { useEffect, useState } from 'react'
import { useGroup } from './group.jsx'
import { loadReceipts, loadItems, loadClaims, loadMeals } from './db.js'
import { getItemEmoji } from './itemEmoji.js'
import { STORE_DOMAINS } from '../config.js'

export const MIN_QUERY_LENGTH = 1

// ── Data ─────────────────────────────────────────────────────
// Cached per group for the session so revisiting the Receipts tab
// shows results right away. Every mount still refetches in the background.
const cache = new Map()

async function fetchSearchData(groupId, nameOf, memberIds) {
  const [rawReceipts, rawItems, claims, meals] = await Promise.all([
    loadReceipts(groupId, nameOf, 'id, store_name, receipt_date, created_at, paid_by_member, member_ids, tip, tax, fees'),
    loadItems(groupId, 'id, receipt_id, meal_id, name, price, always_split, created_at'),
    loadClaims(memberIds, nameOf),
    loadMeals(groupId, 'id, receipt_id, name, fee'),
  ])

  const mealsById = {}
  const mealFeesByReceipt = {}
  for (const m of meals) {
    mealsById[m.id] = m
    mealFeesByReceipt[m.receipt_id] = (mealFeesByReceipt[m.receipt_id] || 0) + Number(m.fee || 0)
  }
  const claimersByItem = {}
  for (const c of claims) {
    if (!claimersByItem[c.item_id]) claimersByItem[c.item_id] = []
    claimersByItem[c.item_id].push(c.roommate)
  }
  const itemTotalByReceipt = {}
  for (const i of rawItems) {
    itemTotalByReceipt[i.receipt_id] = (itemTotalByReceipt[i.receipt_id] || 0) + Number(i.price || 0)
  }

  const receiptsById = {}
  const receipts = rawReceipts.map(r => {
    const receipt = {
      ...r,
      date: r.receipt_date || r.created_at?.slice(0, 10) || '',
      members: effectiveMembers(r),
      total: (itemTotalByReceipt[r.id] || 0) + Number(r.tip || 0) + Number(r.tax || 0)
        + Number(r.fees || 0) + (mealFeesByReceipt[r.id] || 0),
    }
    receiptsById[r.id] = receipt
    return receipt
  })

  const items = rawItems
    .filter(i => receiptsById[i.receipt_id])
    .map(i => ({
      ...i,
      receipt: receiptsById[i.receipt_id],
      meal: i.meal_id ? mealsById[i.meal_id] : null,
      claimers: dedupeNames(claimersByItem[i.id] || []),
    }))

  const newestFirst = (a, b) => b.date.localeCompare(a.date) || (b.created_at || '').localeCompare(a.created_at || '')
  receipts.sort(newestFirst)
  items.sort((a, b) => newestFirst(a.receipt, b.receipt) || (b.created_at || '').localeCompare(a.created_at || ''))

  return { receipts, items }
}

function effectiveMembers(receipt) {
  const members = receipt.members || []
  const payer = receipt.paid_by
  if (!payer || members.some(m => m.toLowerCase() === payer.toLowerCase())) return members
  return [...members, payer]
}

function dedupeNames(names) {
  const seen = new Set()
  return names.filter(n => {
    const lc = n.toLowerCase()
    if (seen.has(lc)) return false
    seen.add(lc)
    return true
  })
}

export function useSearchData() {
  const { group, nameOf, memberIds } = useGroup()
  const [data, setData] = useState(() => cache.get(group.id) || null)
  useEffect(() => {
    let cancelled = false
    fetchSearchData(group.id, nameOf, memberIds).then(d => {
      cache.set(group.id, d)
      if (!cancelled) setData(d)
    }, () => {
      // Nothing cached: show that it failed instead of loading forever
      if (!cancelled && !cache.has(group.id)) setData({ failed: true, receipts: [], items: [] })
    })
    return () => { cancelled = true }
  }, [group.id])
  return data
}

// ── Matching ─────────────────────────────────────────────────
// Case-insensitive; every query word must appear somewhere (any order).
// Trailing plural "s" is ignored on both sides, so "buns" finds "Bun".

function stem(word) {
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word
}

function normalize(text) {
  return (text || '').toLowerCase().replace(/['’]/g, '').split(/\s+/).filter(Boolean).map(stem).join(' ')
}

export function queryTerms(query) {
  if (query.trim().length < MIN_QUERY_LENGTH) return []
  return normalize(query).split(' ').filter(Boolean)
}

function matches(text, terms) {
  const normalized = normalize(text)
  return terms.every(t => normalized.includes(t))
}

export function searchAll(data, query) {
  const terms = queryTerms(query)
  if (!data || terms.length === 0) return { items: [], receipts: [], terms }
  return {
    items: data.items.filter(i => matches(i.name, terms)),
    receipts: data.receipts.filter(r => matches(r.store_name, terms)),
    terms,
  }
}

// ── Recent searches ──────────────────────────────────────────
const RECENT_KEY = 'recent-searches'
const RECENT_MAX = 6

export function getRecentSearches() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || [] } catch { return [] }
}

export function addRecentSearch(query) {
  const q = query.trim()
  if (q.length < MIN_QUERY_LENGTH) return
  const next = [q, ...getRecentSearches().filter(r => r.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch {}
}

export function clearRecentSearches() {
  try { localStorage.removeItem(RECENT_KEY) } catch {}
}

export function RecentSearches({ onPick }) {
  const [recent, setRecent] = useState(getRecentSearches)
  if (recent.length === 0) {
    return <p className="text-sm text-gray-400 px-1">Search items or stores, e.g. "bao" or "costco".</p>
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-2 px-1">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Recent</p>
        <button
          onClick={() => { clearRecentSearches(); setRecent([]) }}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Clear
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {recent.map(r => (
          <button
            key={r}
            onClick={() => onPick(r)}
            className="px-3 py-1.5 rounded-full bg-gray-100 hover:bg-gray-200 text-sm text-gray-700 transition"
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Display ──────────────────────────────────────────────────

export function receiptLink(receipt) {
  return `/receipt/${receipt.id}`
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getStoreLogo(storeName) {
  if (!storeName) return null
  const lower = storeName.toLowerCase()
  const match = STORE_DOMAINS.find(({ keywords }) => keywords.some(k => lower.includes(k)))
  return match ? `https://www.google.com/s2/favicons?domain=${match.domain}&sz=32` : null
}

// Bolds each matched search term within text
export function Highlight({ text, terms }) {
  if (!text) return null
  const lower = text.toLowerCase()
  const marks = new Array(text.length).fill(false)
  for (const t of terms) {
    let i = lower.indexOf(t)
    while (i !== -1) {
      for (let j = i; j < i + t.length; j++) marks[j] = true
      i = lower.indexOf(t, i + t.length)
    }
  }
  const parts = []
  let start = 0
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || marks[i] !== marks[start]) {
      const chunk = text.slice(start, i)
      parts.push(marks[start] ? <strong key={start} className="font-semibold text-gray-900">{chunk}</strong> : chunk)
      start = i
    }
  }
  return <>{parts}</>
}

function claimLabel(item) {
  if (item.always_split) return 'Split by all'
  if (item.claimers.length === 0) return item.receipt.paid_by ? `Unclaimed (${item.receipt.paid_by})` : 'Unclaimed'
  return item.claimers.join(', ')
}

export function ItemRow({ item, terms, myName, onClick }) {
  const me = myName.toLowerCase()
  const mine = item.always_split
    ? item.receipt.members.some(m => m.toLowerCase() === me)
    : item.claimers.some(c => c.toLowerCase() === me)
  const emoji = getItemEmoji(item.name)
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition text-left">
      <RowIcon>{emoji || '🛒'}</RowIcon>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-gray-700 truncate"><Highlight text={item.name} terms={terms} /></p>
          <span className="text-sm font-semibold text-gray-700 shrink-0">${Number(item.price || 0).toFixed(2)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3 mt-0.5">
          <p className="text-xs text-gray-400 truncate">
            {item.receipt.store_name || 'Receipt'} · {formatDate(item.receipt.date)}
            {item.meal && <> · {item.meal.name}</>}
            {' · '}{claimLabel(item)}
          </p>
          {mine && <span className="text-xs font-semibold text-accent-600 shrink-0">✓ You</span>}
        </div>
      </div>
    </button>
  )
}

export function ReceiptRow({ receipt, terms, onClick }) {
  const logo = getStoreLogo(receipt.store_name)
  const others = receipt.members.filter(m => m.toLowerCase() !== (receipt.paid_by || '').toLowerCase())
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition text-left">
      <RowIcon>{logo ? <img src={logo} alt="" className="w-5 h-5 rounded object-contain" /> : '🧾'}</RowIcon>
      <div className="min-w-0 flex-1">
        <p className="text-gray-700 truncate">
          <Highlight text={receipt.store_name || 'Receipt'} terms={terms} />
        </p>
        <p className="text-xs text-gray-400 truncate mt-0.5">
          {formatDate(receipt.date)}
          {receipt.paid_by && <> · Paid by {receipt.paid_by}</>}
          {others.length > 0 && <> · with {others.join(', ')}</>}
        </p>
      </div>
      {receipt.total > 0 && (
        <span className="text-sm font-semibold text-gray-700 shrink-0">${receipt.total.toFixed(2)}</span>
      )}
    </button>
  )
}

// Fixed square so emoji and logos center the same way in every row
function RowIcon({ children }) {
  return (
    <span className="w-8 h-8 flex items-center justify-center shrink-0 text-xl leading-none -translate-y-[1.5px]">
      {children}
    </span>
  )
}

export function ResultSection({ title, count, children, footer }) {
  return (
    <section>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 px-1">
        {title} · {count}
      </p>
      {count > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm divide-y divide-gray-100">
          {children}
          {footer}
        </div>
      )}
    </section>
  )
}

// ── Search input ─────────────────────────────────────────────
// Native search-input clear button is hidden in index.css; this draws our own.
export function SearchInput({ value, onChange, onKeyDown, onFocus, onBlur, autoFocus }) {
  return (
    <div className="relative">
      <svg className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
      </svg>
      <input
        autoFocus={autoFocus}
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder="Search items or stores"
        className="w-full pl-10 pr-10 py-2.5 bg-white border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-accent-400"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onMouseDown={e => e.preventDefault()}
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}
