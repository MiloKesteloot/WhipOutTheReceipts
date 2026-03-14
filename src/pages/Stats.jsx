import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'  // used in trip timeline
import { supabase } from '../lib/supabase.js'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, Cell, LineChart, Line,
} from 'recharts'

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#f43f5e', '#3b82f6', '#8b5cf6', '#ec4899']
const toTitleCase = s => s.replace(/\b\w/g, c => c.toUpperCase())

// Compute per-person total consumption (their share of everything they claimed, incl. tip/tax/fees/meal fees)
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

  const consumed = {} // person -> dollars

  // Item shares
  for (const item of items) {
    const claimers = claimsByItem[item.id] || []
    if (!claimers.length) continue
    const share = item.price / claimers.length
    for (const person of claimers) {
      consumed[person] = (consumed[person] || 0) + share
    }
  }

  // Tip/tax/fees shares (proportional to claimed item cost per receipt)
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

  // Meal fee shares
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

export default function Stats() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)

  useEffect(() => {
    async function load() {
      const [tripsRes, receiptsRes, itemsRes, claimsRes, mealsRes, settlementsRes] = await Promise.all([
        supabase.from('trips').select('*').order('created_at'),
        supabase.from('receipts').select('*'),
        supabase.from('items').select('id, receipt_id, meal_id, name, price'),
        supabase.from('claims').select('item_id, roommate'),
        supabase.from('meals').select('id, receipt_id, name, fee'),
        supabase.from('settlements').select('trip_id, debtor, creditor, created_at'),
      ])

      const trips = tripsRes.data || []
      const receipts = receiptsRes.data || []
      const items = itemsRes.data || []
      const claims = claimsRes.data || []
      const meals = mealsRes.data || []
      const settlements = settlementsRes.data || []

      // --- Per-person: totalPaid, totalConsumed, net ---
      const totalPaid = {}
      for (const r of receipts) {
        const receiptItems = items.filter(i => i.receipt_id === r.id)
        const total = receiptItems.reduce((s, i) => s + i.price, 0)
          + (r.tip || 0) + (r.tax || 0) + (r.fees || 0)
        const mealFees = meals.filter(m => m.receipt_id === r.id).reduce((s, m) => s + (m.fee || 0), 0)
        totalPaid[r.paid_by] = (totalPaid[r.paid_by] || 0) + total + mealFees
      }

      const totalConsumed = computeConsumption(receipts, items, claims, meals)

      const allPeople = [...new Set([...Object.keys(totalPaid), ...Object.keys(totalConsumed)])]
      const personCards = allPeople.map(p => ({
        name: p,
        paid: totalPaid[p] || 0,
        consumed: totalConsumed[p] || 0,
        net: (totalPaid[p] || 0) - (totalConsumed[p] || 0),
      })).sort((a, b) => b.paid - a.paid)

      // --- Spending over time: per trip, stacked by payer ---
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

      // --- Fair share ---
      const totalHousehold = Object.values(totalConsumed).reduce((s, v) => s + v, 0)
      const totalPaidAll = Object.values(totalPaid).reduce((s, v) => s + v, 0)
      const fairShare = personCards.map(p => ({
        name: toTitleCase(p.name),
        'Paid %': totalPaidAll ? Math.round(p.paid / totalPaidAll * 100) : 0,
        'Consumed %': totalHousehold ? Math.round(p.consumed / totalHousehold * 100) : 0,
      }))

      // --- Most purchased items ---
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

      // --- Store breakdown ---
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

      // --- Settlement speed (days from trip creation to settlement) ---
      const tripCreatedAt = {}
      for (const t of trips) tripCreatedAt[t.id] = new Date(t.created_at)
      const settlementDays = {}
      for (const s of settlements) {
        const tripDate = tripCreatedAt[s.trip_id]
        if (!tripDate) continue
        const days = (new Date(s.created_at) - tripDate) / (1000 * 60 * 60 * 24)
        if (!settlementDays[s.debtor]) settlementDays[s.debtor] = []
        settlementDays[s.debtor].push(days)
      }
      const settlementSpeed = Object.entries(settlementDays).map(([person, days]) => ({
        name: toTitleCase(person),
        avgDays: Math.round(days.reduce((s, d) => s + d, 0) / days.length * 10) / 10,
        count: days.length,
      })).sort((a, b) => a.avgDays - b.avgDays)

      // --- Trip timeline ---
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

      // --- Cumulative personal spending over time ---
      // For each trip (sorted by date), compute each person's consumed share, then accumulate
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
          const row = {
            tripName: trip.name.length > 12 ? trip.name.slice(0, 11) + '…' : trip.name,
          }
          for (const person of allPeople) {
            row[person] = parseFloat(((cumulativeByPerson[person] || 0)).toFixed(2))
          }
          return row
        })
        .filter(Boolean)

      setStats({ personCards, spendingByTrip, payers, fairShare, topItems, topStores, settlementSpeed, tripTimeline, totalPaidAll, cumulativeLineData, allPeople })
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div className="max-w-2xl mx-auto p-8 text-gray-400">Loading…</div>
  if (!stats) return null

  const { personCards, spendingByTrip, payers, fairShare, topItems, topStores, settlementSpeed, tripTimeline, totalPaidAll, cumulativeLineData, allPeople } = stats

  const maxStore = topStores[0]?.total || 1
  const maxItem = topItems[0]?.count || 1

  return (
    <div className="max-w-2xl mx-auto p-4 py-8 space-y-10">
      <h1 className="text-2xl font-bold text-gray-900">Household Stats</h1>

      {/* Per-person summary cards */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">By person</h2>
        <div className="grid grid-cols-2 gap-3">
          {personCards.map((p, i) => (
            <div key={p.name} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
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
          ))}
        </div>
      </section>

      {/* Cumulative personal spending */}
      {cumulativeLineData.length > 1 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-1">Cumulative food spending</h2>
          <p className="text-xs text-gray-400 mb-3">Running total of each person's actual share of food costs over time</p>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={cumulativeLineData} margin={{ top: 4, right: 16, left: -10, bottom: 40 }}>
                <XAxis dataKey="tripName" tick={{ fontSize: 11, fill: '#9ca3af' }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `$${v}`} />
                <Tooltip formatter={(v, name) => [`$${v.toFixed(2)}`, toTitleCase(name)]} />
                <Legend formatter={v => toTitleCase(v)} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                {allPeople.map((person, i) => (
                  <Line
                    key={person}
                    type="monotone"
                    dataKey={person}
                    stroke={COLORS[i % COLORS.length]}
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

      {/* Spending over time */}
      {spendingByTrip.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Spending per trip</h2>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={spendingByTrip} margin={{ top: 4, right: 4, left: -10, bottom: 40 }}>
                <XAxis dataKey="tripName" tick={{ fontSize: 11, fill: '#9ca3af' }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `$${v}`} />
                <Tooltip formatter={(v, name) => [`$${v.toFixed(2)}`, toTitleCase(name)]} />
                <Legend formatter={v => toTitleCase(v)} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                {payers.map((payer, i) => (
                  <Bar key={payer} dataKey={payer} stackId="a" fill={COLORS[i % COLORS.length]} radius={i === payers.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Fair share */}
      {fairShare.length > 0 && totalPaidAll > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-1">Fair share</h2>
          <p className="text-xs text-gray-400 mb-3">% of household spending paid vs. consumed</p>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <ResponsiveContainer width="100%" height={Math.max(180, fairShare.length * 52)}>
              <BarChart data={fairShare} layout="vertical" margin={{ top: 4, right: 40, left: 40, bottom: 4 }}>
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
                      <div
                        className="bg-indigo-400 h-1.5 rounded-full"
                        style={{ width: `${(store.total / maxStore) * 100}%` }}
                      />
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
                      <div
                        className="bg-amber-400 h-1.5 rounded-full"
                        style={{ width: `${(item.count / maxItem) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">{item.count}×</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Settlement speed */}
      {settlementSpeed.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-1">Settlement speed</h2>
          <p className="text-xs text-gray-400 mb-3">Average days from trip creation to marking as sent</p>
          <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
            {settlementSpeed.map((p, i) => (
              <div key={p.name} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-5 text-right">{i + 1}</span>
                  <span className="font-medium text-gray-800">{p.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">{p.count} settlement{p.count !== 1 ? 's' : ''}</span>
                  <span className={`font-semibold text-sm ${p.avgDays <= 3 ? 'text-green-600' : p.avgDays <= 10 ? 'text-amber-500' : 'text-red-400'}`}>
                    {p.avgDays}d avg
                  </span>
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
