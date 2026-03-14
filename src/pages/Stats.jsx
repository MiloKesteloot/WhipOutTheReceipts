import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { fetchCoreRoommates } from './Settings.jsx'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, LineChart, Line, PieChart, Pie, Cell,
} from 'recharts'

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#f43f5e', '#3b82f6', '#8b5cf6', '#ec4899']
const toTitleCase = s => s.replace(/\b\w/g, c => c.toUpperCase())

function computeConsumption(receipts, items, claims, meals) {
  const payerByReceipt = {}
  const tipTaxFeesByReceipt = {}
  for (const r of receipts) {
    payerByReceipt[r.id] = r.paid_by
    tipTaxFeesByReceipt[r.id] = (r.tip || 0) + (r.tax || 0) + (r.fees || 0)
  }

  const claimsByItem = {}
  for (const c of claims) {
    if (!claimsByItem[c.item_id]) claimsByItem[c.item_id] = []
    claimsByItem[c.item_id].push(c.roommate)
  }

  const itemsByReceipt = {}
  const itemsByMeal = {}
  for (const item of items) {
    if (!itemsByReceipt[item.receipt_id]) itemsByReceipt[item.receipt_id] = []
    itemsByReceipt[item.receipt_id].push(item)
    if (item.meal_id) {
      if (!itemsByMeal[item.meal_id]) itemsByMeal[item.meal_id] = []
      itemsByMeal[item.meal_id].push(item)
    }
  }

  const consumed = {}

  for (const item of items) {
    const claimers = claimsByItem[item.id] || []
    if (!claimers.length) continue
    const share = item.price / claimers.length
    for (const person of claimers) {
      consumed[person] = (consumed[person] || 0) + share
    }
  }

  for (const receipt of receipts) {
    const extra = tipTaxFeesByReceipt[receipt.id]
    if (!extra) continue
    const receiptItems = itemsByReceipt[receipt.id] || []
    const effectiveByPerson = {}
    for (const item of receiptItems) {
      const claimers = claimsByItem[item.id] || []
      if (!claimers.length) continue
      const share = item.price / claimers.length
      for (const p of claimers) {
        effectiveByPerson[p] = (effectiveByPerson[p] || 0) + share
      }
    }
    const total = Object.values(effectiveByPerson).reduce((s, v) => s + v, 0)
    if (!total) continue
    for (const [person, eff] of Object.entries(effectiveByPerson)) {
      consumed[person] = (consumed[person] || 0) + extra * (eff / total)
    }
  }

  for (const meal of meals) {
    const fee = meal.fee || 0
    if (!fee) continue
    const mealItems = itemsByMeal[meal.id] || []
    const effectiveByPerson = {}
    for (const item of mealItems) {
      const claimers = claimsByItem[item.id] || []
      if (!claimers.length) continue
      const share = item.price / claimers.length
      for (const p of claimers) {
        effectiveByPerson[p] = (effectiveByPerson[p] || 0) + share
      }
    }
    const total = Object.values(effectiveByPerson).reduce((s, v) => s + v, 0)
    if (!total) continue
    for (const [person, eff] of Object.entries(effectiveByPerson)) {
      consumed[person] = (consumed[person] || 0) + fee * (eff / total)
    }
  }

  return consumed
}

// Custom tooltip for the line chart — sorted by value descending
function SortedLineTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const sorted = [...payload]
    .filter(e => e.value != null)
    .sort((a, b) => b.value - a.value)
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm min-w-[160px]">
      <p className="font-medium text-gray-600 mb-2 text-xs">{label}</p>
      {sorted.map(entry => (
        <div key={entry.dataKey} className="flex items-center justify-between gap-4 py-0.5">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: entry.color }} />
            <span className="text-gray-700">{toTitleCase(entry.dataKey)}</span>
          </div>
          <span className="font-semibold text-gray-900">${Number(entry.value).toFixed(2)}</span>
        </div>
      ))}
    </div>
  )
}

export default function Stats() {
  const myName = (localStorage.getItem('global-name') || '').toLowerCase()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [selectedPeople, setSelectedPeople] = useState(null)

  useEffect(() => {
    async function load() {
      const [tripsRes, receiptsRes, itemsRes, claimsRes, mealsRes, settlementsRes] = await Promise.all([
        supabase.from('trips').select('*').order('created_at'),
        supabase.from('receipts').select('*'),
        supabase.from('items').select('id, receipt_id, meal_id, name, price'),
        supabase.from('claims').select('item_id, roommate'),
        supabase.from('meals').select('id, receipt_id, name, fee'),
        supabase.from('settlements').select('*'),
      ])

      const trips = tripsRes.data || []
      const receipts = receiptsRes.data || []
      const items = itemsRes.data || []
      const claims = claimsRes.data || []
      const meals = mealsRes.data || []
      const settlements = settlementsRes.data || []

      // Core roommates = from Apartment Settings in DB
      const coreList = await fetchCoreRoommates()
      const coreRoommatesLower = new Set(coreList.map(m => m.toLowerCase()))
      coreRoommatesLower.add(myName)

      // All people = anyone who has paid, claimed, or is a trip member
      const totalPaid = {}
      for (const r of receipts) {
        const receiptItems = items.filter(i => i.receipt_id === r.id)
        const total = receiptItems.reduce((s, i) => s + i.price, 0)
          + (r.tip || 0) + (r.tax || 0) + (r.fees || 0)
        const mealFees = meals.filter(m => m.receipt_id === r.id).reduce((s, m) => s + (m.fee || 0), 0)
        totalPaid[r.paid_by] = (totalPaid[r.paid_by] || 0) + total + mealFees
      }

      const totalConsumed = computeConsumption(receipts, items, claims, meals)

      const allPeople = [...new Set([
        ...Object.keys(totalPaid),
        ...Object.keys(totalConsumed),
        ...trips.flatMap(t => t.members || []).filter(m => typeof m === 'string'),
      ])]

      const defaultSelected = new Set(
        allPeople
          .filter(p => coreRoommatesLower.has(p.toLowerCase()))
          .map(p => p.toLowerCase())
      )

      const personCards = allPeople.map(p => ({
        name: p,
        paid: totalPaid[p] || 0,
        consumed: totalConsumed[p] || 0,
        net: (totalPaid[p] || 0) - (totalConsumed[p] || 0),
      })).sort((a, b) => b.paid - a.paid)

      // Spending per trip
      const tripIdToName = {}
      for (const t of trips) tripIdToName[t.id] = t.name
      const payers = [...new Set(receipts.map(r => r.paid_by))]

      const spendingByTrip = trips.map(trip => {
        const row = { tripName: trip.name.length > 14 ? trip.name.slice(0, 13) + '…' : trip.name }
        const tripReceipts = receipts.filter(r => r.trip_id === trip.id)
        for (const payer of payers) row[payer] = 0
        for (const r of tripReceipts) {
          const itemsTotal = items.filter(i => i.receipt_id === r.id).reduce((s, i) => s + i.price, 0)
          const mealFees = meals.filter(m => m.receipt_id === r.id).reduce((s, m) => s + (m.fee || 0), 0)
          const total = itemsTotal + (r.tip || 0) + (r.tax || 0) + (r.fees || 0) + mealFees
          row[r.paid_by] = (row[r.paid_by] || 0) + total
        }
        return row
      }).filter(row => payers.some(p => row[p] > 0))

      // Fair share
      const totalHousehold = Object.values(totalConsumed).reduce((s, v) => s + v, 0)
      const totalPaidAll = Object.values(totalPaid).reduce((s, v) => s + v, 0)
      const fairShare = personCards.map(p => ({
        name: toTitleCase(p.name),
        nameLower: p.name.toLowerCase(),
        'Paid %': totalPaidAll ? Math.round(p.paid / totalPaidAll * 100) : 0,
        'Consumed %': totalHousehold ? Math.round(p.consumed / totalHousehold * 100) : 0,
      }))

      // Most purchased items
      const itemFreq = {}
      for (const item of items) {
        const key = item.name.trim().toLowerCase()
        if (!key) continue
        if (!itemFreq[key]) itemFreq[key] = { name: item.name.trim(), count: 0, total: 0 }
        itemFreq[key].count += 1
        itemFreq[key].total += item.price
      }
      const topItems = Object.values(itemFreq)
        .sort((a, b) => b.count - a.count || b.total - a.total)
        .slice(0, 15)

      // Store breakdown
      const storeMap = {}
      for (const r of receipts) {
        const store = r.store_name || 'Unknown'
        const itemsTotal = items.filter(i => i.receipt_id === r.id).reduce((s, i) => s + i.price, 0)
        const mealFees = meals.filter(m => m.receipt_id === r.id).reduce((s, m) => s + (m.fee || 0), 0)
        const total = itemsTotal + (r.tip || 0) + (r.tax || 0) + (r.fees || 0) + mealFees
        if (!storeMap[store]) storeMap[store] = { name: store, total: 0, visits: 0 }
        storeMap[store].total += total
        storeMap[store].visits += 1
      }
      const topStores = Object.values(storeMap).sort((a, b) => b.total - a.total)


      // Trip timeline
      const tripTimeline = trips.map(trip => {
        const tripReceipts = receipts.filter(r => r.trip_id === trip.id)
        const itemsTotal = items
          .filter(i => tripReceipts.some(r => r.id === i.receipt_id))
          .reduce((s, i) => s + i.price, 0)
        const extras = tripReceipts.reduce((s, r) => s + (r.tip || 0) + (r.tax || 0) + (r.fees || 0), 0)
        const mealFees = meals
          .filter(m => tripReceipts.some(r => r.id === m.receipt_id))
          .reduce((s, m) => s + (m.fee || 0), 0)
        return {
          id: trip.id,
          name: trip.name,
          date: new Date(trip.created_at),
          total: itemsTotal + extras + mealFees,
          closed: trip.closed,
        }
      }).filter(t => t.total > 0)

      // Cumulative personal spending
      const receiptsByTrip = {}
      for (const r of receipts) {
        if (!receiptsByTrip[r.trip_id]) receiptsByTrip[r.trip_id] = []
        receiptsByTrip[r.trip_id].push(r)
      }
      const itemsByReceipt2 = {}
      for (const item of items) {
        if (!itemsByReceipt2[item.receipt_id]) itemsByReceipt2[item.receipt_id] = []
        itemsByReceipt2[item.receipt_id].push(item)
      }
      const mealsByReceipt = {}
      for (const meal of meals) {
        if (!mealsByReceipt[meal.receipt_id]) mealsByReceipt[meal.receipt_id] = []
        mealsByReceipt[meal.receipt_id].push(meal)
      }

      const sortedTrips = trips.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      const cumulativeByPerson = {}
      const cumulativeLineData = sortedTrips
        .map(trip => {
          const tripReceipts = receiptsByTrip[trip.id] || []
          if (!tripReceipts.length) return null
          const tripItems = tripReceipts.flatMap(r => itemsByReceipt2[r.id] || [])
          const tripMeals = tripReceipts.flatMap(r => mealsByReceipt[r.id] || [])
          const tripItemIds = new Set(tripItems.map(i => i.id))
          const tripClaims = claims.filter(c => tripItemIds.has(c.item_id))
          const tripConsumed = computeConsumption(tripReceipts, tripItems, tripClaims, tripMeals)
          if (!Object.keys(tripConsumed).length) return null

          for (const [person, amt] of Object.entries(tripConsumed)) {
            cumulativeByPerson[person] = (cumulativeByPerson[person] || 0) + amt
          }
          const row = { tripName: trip.name.length > 12 ? trip.name.slice(0, 11) + '…' : trip.name }
          for (const person of allPeople) {
            row[person] = parseFloat((cumulativeByPerson[person] || 0).toFixed(2))
          }
          return row
        })
        .filter(Boolean)

      // Spending by category
      const categoryTotals = {}
      for (const r of receipts) {
        const cat = r.category || 'Groceries'
        const receiptItems = itemsByReceipt2[r.id] || []
        const itemsTotal = receiptItems.reduce((s, i) => s + (i.price || 0), 0)
        const extras = (r.tip || 0) + (r.tax || 0) + (r.fees || 0)
        const mealFees = (mealsByReceipt[r.trip_id] || []).filter(m => receipts.find(rx => rx.id === m.receipt_id)?.trip_id === r.trip_id).length === 0
          ? 0
          : (mealsByReceipt[r.id] || []).reduce((s, m) => s + (m.fee || 0), 0)
        categoryTotals[cat] = (categoryTotals[cat] || 0) + itemsTotal + extras + mealFees
      }
      const spendingByCategory = Object.entries(categoryTotals)
        .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }))
        .sort((a, b) => b.value - a.value)

      setStats({
        personCards, spendingByTrip, payers, fairShare, topItems, topStores,
        tripTimeline, totalPaidAll, cumulativeLineData, allPeople,
        coreRoommatesLower, defaultSelected, spendingByCategory,
      })
      setLoading(false)
    }
    load()
  }, [myName])

  // Initialize selectedPeople once stats load
  useEffect(() => {
    if (stats && selectedPeople === null) {
      setSelectedPeople(stats.defaultSelected)
    }
  }, [stats, selectedPeople])

  if (loading) return <div className="max-w-2xl mx-auto p-8 text-gray-400">Loading…</div>
  if (!stats) return null

  const {
    personCards, spendingByTrip, payers, fairShare, topItems, topStores,
    tripTimeline, totalPaidAll, cumulativeLineData, allPeople,
    coreRoommatesLower, spendingByCategory,
  } = stats

  const selected = selectedPeople || stats.defaultSelected

  // People visible in charts (preserving original casing from allPeople)
  const visiblePeople = allPeople.filter(p => selected.has(p.toLowerCase()))
  const visibleCards = personCards.filter(p => selected.has(p.name.toLowerCase()))
  const visibleFairShare = fairShare.filter(p => selected.has(p.nameLower))
  const visiblePayers = payers.filter(p => selected.has(p.toLowerCase()))

  // For fair share, recalculate percentages based on visible subset
  const visibleTotalPaid = visibleCards.reduce((s, p) => s + p.paid, 0)
  const visibleTotalConsumed = visibleCards.reduce((s, p) => s + p.consumed, 0)
  const visibleFairShareRecalc = visibleCards.map(p => ({
    name: toTitleCase(p.name),
    'Paid %': visibleTotalPaid ? Math.round(p.paid / visibleTotalPaid * 100) : 0,
    'Consumed %': visibleTotalConsumed ? Math.round(p.consumed / visibleTotalConsumed * 100) : 0,
  }))

  const maxStore = topStores[0]?.total || 1
  const maxItem = topItems[0]?.count || 1

  // Group people for checkboxes: core roommates vs others
  const coreInData = allPeople.filter(p => coreRoommatesLower.has(p.toLowerCase()))
  const othersInData = allPeople.filter(p => !coreRoommatesLower.has(p.toLowerCase()))

  function togglePerson(nameLower) {
    setSelectedPeople(prev => {
      const next = new Set(prev)
      next.has(nameLower) ? next.delete(nameLower) : next.add(nameLower)
      return next
    })
  }

  return (
    <div className="max-w-2xl mx-auto p-4 py-8 space-y-10">
      <h1 className="text-2xl font-bold text-gray-900">Household Stats</h1>

      {/* Person filter */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Show people</h2>
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          {coreInData.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-2">Roommates</p>
              <div className="flex flex-wrap gap-2">
                {coreInData.map(person => {
                  const isSelected = selected.has(person.toLowerCase())
                  return (
                    <button
                      key={person}
                      onClick={() => togglePerson(person.toLowerCase())}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                        isSelected
                          ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                          : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${isSelected ? 'bg-indigo-500' : 'bg-gray-300'}`} />
                      {toTitleCase(person)}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {othersInData.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-2">Others</p>
              <div className="flex flex-wrap gap-2">
                {othersInData.map(person => {
                  const isSelected = selected.has(person.toLowerCase())
                  return (
                    <button
                      key={person}
                      onClick={() => togglePerson(person.toLowerCase())}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                        isSelected
                          ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                          : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${isSelected ? 'bg-indigo-500' : 'bg-gray-300'}`} />
                      {toTitleCase(person)}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Cumulative personal spending — moved to top */}
      {cumulativeLineData.length > 1 && visiblePeople.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-1">Cumulative food spending</h2>
          <p className="text-xs text-gray-400 mb-3">Running total of each person's actual share of food costs over time</p>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={cumulativeLineData} margin={{ top: 4, right: 16, left: -10, bottom: 40 }}>
                <XAxis dataKey="tripName" tick={{ fontSize: 11, fill: '#9ca3af' }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `$${v}`} />
                <Tooltip content={<SortedLineTooltip />} />
                <Legend formatter={v => toTitleCase(v)} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                {visiblePeople.map((person, i) => (
                  <Line
                    key={person}
                    type="monotone"
                    dataKey={person}
                    stroke={COLORS[allPeople.indexOf(person) % COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Per-person summary cards */}
      {visibleCards.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">By person</h2>
          <div className="grid grid-cols-2 gap-3">
            {visibleCards.map((p) => {
              const colorIdx = allPeople.indexOf(p.name) % COLORS.length
              return (
                <div key={p.name} className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[colorIdx] }} />
                    <span className="font-semibold text-gray-900 truncate">{toTitleCase(p.name)}</span>
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Paid</span>
                      <span className="font-medium text-gray-800">${p.paid.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Consumed</span>
                      <span className="font-medium text-gray-800">${p.consumed.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-t border-gray-100 pt-1.5 mt-1.5">
                      <span className="text-gray-500">Net balance</span>
                      <span className={`font-semibold ${p.net > 0.01 ? 'text-green-600' : p.net < -0.01 ? 'text-amber-600' : 'text-gray-500'}`}>
                        {p.net > 0.01 ? '+' : ''}{p.net.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Spending per trip */}
      {spendingByTrip.length > 0 && visiblePayers.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Spending per trip</h2>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={spendingByTrip} margin={{ top: 4, right: 4, left: -10, bottom: 40 }}>
                <XAxis dataKey="tripName" tick={{ fontSize: 11, fill: '#9ca3af' }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `$${v}`} />
                <Tooltip formatter={(v, name) => [`$${v.toFixed(2)}`, toTitleCase(name)]} />
                <Legend formatter={v => toTitleCase(v)} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                {visiblePayers.map((payer, i) => (
                  <Bar key={payer} dataKey={payer} stackId="a" fill={COLORS[allPeople.indexOf(payer) % COLORS.length]} radius={i === visiblePayers.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Fair share */}
      {visibleFairShareRecalc.length > 0 && visibleTotalPaid > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-1">Fair share</h2>
          <p className="text-xs text-gray-400 mb-3">% of household spending paid vs. consumed</p>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <ResponsiveContainer width="100%" height={Math.max(180, visibleFairShareRecalc.length * 52)}>
              <BarChart data={visibleFairShareRecalc} layout="vertical" margin={{ top: 4, right: 40, left: 40, bottom: 4 }}>
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `${v}%`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#374151' }} width={60} />
                <Tooltip formatter={v => `${v}%`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Paid %" fill="#6366f1" radius={[0, 3, 3, 0]} barSize={12} />
                <Bar dataKey="Consumed %" fill="#f59e0b" radius={[0, 3, 3, 0]} barSize={12} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Spending by category */}
      {spendingByCategory.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Spending by category</h2>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-6">
              <div className="shrink-0">
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie
                      data={spendingByCategory}
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={72}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {spendingByCategory.map((entry) => (
                        <Cell key={entry.name} fill={
                          entry.name === 'Groceries'      ? '#10b981' :
                          entry.name === 'Dining'         ? '#f59e0b' :
                          entry.name === 'Transportation' ? '#3b82f6' :
                                                           '#9ca3af'
                        } />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => `$${v.toFixed(2)}`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-3">
                {spendingByCategory.map(({ name, value }) => {
                  const total = spendingByCategory.reduce((s, c) => s + c.value, 0)
                  const pct = total > 0 ? (value / total) * 100 : 0
                  const color =
                    name === 'Groceries'      ? '#10b981' :
                    name === 'Dining'         ? '#f59e0b' :
                    name === 'Transportation' ? '#3b82f6' :
                                               '#9ca3af'
                  return (
                    <div key={name}>
                      <div className="flex justify-between text-sm mb-1">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                          <span className="text-gray-700 font-medium">{name}</span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-500">
                          <span>${value.toFixed(2)}</span>
                          <span className="text-xs text-gray-400">{pct.toFixed(0)}%</span>
                        </div>
                      </div>
                      <div className="bg-gray-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Store breakdown */}
      {topStores.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Stores</h2>
          <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
            {topStores.map((store, i) => (
              <div key={store.name} className="flex items-center gap-3 px-4 py-3">
                <span className="text-xs text-gray-400 w-5 text-right shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="font-medium text-gray-800 truncate">{store.name}</span>
                    <span className="text-sm font-semibold text-gray-900 ml-2 shrink-0">${store.total.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                      <div className="bg-indigo-400 h-1.5 rounded-full" style={{ width: `${(store.total / maxStore) * 100}%` }} />
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">{store.visits} {store.visits === 1 ? 'trip' : 'trips'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Most purchased items */}
      {topItems.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Most purchased items</h2>
          <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
            {topItems.map((item, i) => (
              <div key={item.name} className="flex items-center gap-3 px-4 py-3">
                <span className="text-xs text-gray-400 w-5 text-right shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="font-medium text-gray-800 truncate capitalize">{item.name}</span>
                    <span className="text-sm text-gray-500 ml-2 shrink-0">${item.total.toFixed(2)} total</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                      <div className="bg-amber-400 h-1.5 rounded-full" style={{ width: `${(item.count / maxItem) * 100}%` }} />
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">{item.count}×</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}


      {/* Trip timeline */}
      {tripTimeline.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Trip timeline</h2>
          <div className="relative">
            <div className="absolute left-[4.5rem] top-0 bottom-0 w-px bg-gray-200" />
            <ul className="space-y-3">
              {tripTimeline.map(trip => (
                <li key={trip.id} className="flex items-start gap-4">
                  <div className="w-16 shrink-0 text-right">
                    <span className="text-xs text-gray-400 leading-5">
                      {trip.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <div className="relative z-10 mt-1 w-3 h-3 rounded-full border-2 border-white shrink-0"
                    style={{ background: trip.closed ? '#9ca3af' : '#6366f1' }} />
                  <Link
                    to={`/trip/${trip.id}`}
                    className="flex-1 min-w-0 bg-white border border-gray-200 rounded-lg px-3 py-2 hover:border-indigo-300 transition"
                  >
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="font-medium text-gray-800 truncate text-sm">{trip.name}</span>
                      <span className="text-sm font-semibold text-gray-700 shrink-0">${trip.total.toFixed(2)}</span>
                    </div>
                    {trip.closed && <span className="text-xs text-gray-400">closed</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  )
}
