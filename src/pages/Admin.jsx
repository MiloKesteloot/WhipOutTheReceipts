import { useEffect, useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase } from '../lib/supabase.js'
import { money } from '../lib/ui.js'
import { PageLoading } from '../components/Loading.jsx'
import LoadError from '../components/LoadError.jsx'

// App-wide numbers for the app's owner. The data comes from the admin_stats()
// database function, which refuses everyone but the admin account, so this
// page is only a view: hiding the link isn't what keeps it private.

// Whether the signed-in user is the admin (asks the database; false on error)
export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    let live = true
    supabase.rpc('is_app_admin').then(({ data }) => { if (live) setIsAdmin(data === true) })
    return () => { live = false }
  }, [])
  return isAdmin
}

const card = 'bg-white border border-gray-200 rounded-xl'
const sectionTitle = 'text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3'
const num = n => Number(n || 0).toLocaleString('en-US')

function ago(ts) {
  if (!ts) return '—'
  const days = (Date.now() - new Date(ts)) / 86400000
  if (days < 1 / 24) return 'just now'
  if (days < 1) return `${Math.floor(days * 24)}h ago`
  if (days < 30) return `${Math.floor(days)}d ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const shortDate = ts => ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'

function Tile({ label, value, sub }) {
  return (
    <div className={`${card} p-4`}>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900 tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

const SERIES = [
  { key: 'signups', label: 'Sign-ups' },
  { key: 'groups', label: 'New groups' },
  { key: 'receipts', label: 'Receipts added' },
  { key: 'active_users', label: 'People adding receipts' },
]

function WeeklyChart({ weekly }) {
  const [series, setSeries] = useState('receipts')
  const data = useMemo(() => weekly.map(w => ({
    ...w,
    label: new Date(w.week + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  })), [weekly])
  const current = SERIES.find(s => s.key === series)

  return (
    <div className={`${card} p-4`}>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {SERIES.map(s => (
          <button
            key={s.key}
            onClick={() => setSeries(s.key)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition ${s.key === series ? 'bg-accent-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#f3f4f6" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
            <Tooltip
              cursor={{ fill: '#f3f4f6' }}
              formatter={v => [num(v), current.label]}
              labelFormatter={l => `Week of ${l}`}
              contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13 }}
            />
            <Bar dataKey={series} fill="#16a34a" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-gray-400">Last 26 weeks, by week starting Monday</p>
    </div>
  )
}

function GroupsTable({ groups }) {
  return (
    <div className={`${card} overflow-x-auto`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
            <th className="px-4 py-2.5 font-medium">Group</th>
            <th className="px-3 py-2.5 font-medium text-right">Accounts</th>
            <th className="px-3 py-2.5 font-medium text-right">No account</th>
            <th className="px-3 py-2.5 font-medium text-right">Receipts</th>
            <th className="px-3 py-2.5 font-medium text-right">Spend</th>
            <th className="px-3 py-2.5 font-medium text-right">Payments</th>
            <th className="px-3 py-2.5 font-medium">Last activity</th>
            <th className="px-4 py-2.5 font-medium">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {groups.map(g => (
            <tr key={g.id} className="text-gray-700">
              <td className="px-4 py-2.5">
                <p className="font-medium text-gray-900 whitespace-nowrap">{g.name}</p>
                {g.owner && <p className="text-xs text-gray-400 whitespace-nowrap">Owner: {g.owner}</p>}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">{num(g.accounts)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">
                {num(g.unlinked + g.guests)}
                {g.guests > 0 && <span className="text-xs text-gray-400"> ({g.guests} guest{g.guests === 1 ? '' : 's'})</span>}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">{num(g.receipts)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{money(g.spend)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{num(g.payments)}</td>
              <td className="px-3 py-2.5 whitespace-nowrap text-gray-500">{ago(g.last_activity)}</td>
              <td className="px-4 py-2.5 whitespace-nowrap text-gray-500">{shortDate(g.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UsersTable({ users }) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return users
    return users.filter(u => [u.name, u.email, ...u.groups].some(t => t?.toLowerCase().includes(s)))
  }, [users, q])

  return (
    <>
      <input
        type="search"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Filter by name, email or group"
        className="w-full sm:w-72 h-10 mb-3 border border-gray-300 rounded-lg px-3 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent-400"
      />
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
              <th className="px-4 py-2.5 font-medium">Person</th>
              <th className="px-3 py-2.5 font-medium">Groups</th>
              <th className="px-3 py-2.5 font-medium text-right">Receipts added</th>
              <th className="px-3 py-2.5 font-medium">Sign-in</th>
              <th className="px-3 py-2.5 font-medium">Last seen</th>
              <th className="px-4 py-2.5 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shown.map(u => (
              <tr key={u.id} className="text-gray-700 align-top">
                <td className="px-4 py-2.5">
                  <p className="font-medium text-gray-900 whitespace-nowrap">{u.name || <span className="text-gray-400 font-normal">No name yet</span>}</p>
                  <p className="text-xs text-gray-400 whitespace-nowrap">{u.email}</p>
                </td>
                <td className="px-3 py-2.5">
                  {u.groups.length
                    ? <span className="text-gray-600">{u.groups.join(', ')}</span>
                    : <span className="text-amber-600 text-xs font-medium">No group</span>}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{num(u.receipts_added)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-gray-500">
                  {u.provider === 'google' ? 'Google' : 'Email'}
                  {!u.confirmed && <span className="ml-1 text-xs text-amber-600">(unconfirmed)</span>}
                  {u.has_gemini_key && <span className="ml-1 text-xs text-gray-400">· scan key</span>}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-gray-500">{ago(u.last_sign_in_at)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-gray-500">{shortDate(u.created_at)}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Nobody matches “{q}”</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

export default function Admin() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [denied, setDenied] = useState(false)

  async function load() {
    setError(null)
    const { data, error } = await supabase.rpc('admin_stats')
    if (error) {
      if (error.code === '42501') setDenied(true)
      else setError(error)
      return
    }
    setData(data)
  }
  useEffect(() => { load() }, [])

  if (denied) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-gray-900">Admin</h1>
        <p className="mt-4 text-gray-500">This page is only for the app's admin.</p>
      </div>
    )
  }
  if (error) return <LoadError onRetry={load} />
  if (!data) return <PageLoading />

  const t = data.totals
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Admin</h1>
        <button onClick={() => { setData(null); load() }} className="text-sm text-accent-600 hover:text-accent-700">
          Refresh
        </button>
      </div>

      <section>
        <h2 className={sectionTitle}>People</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Accounts" value={num(t.users)} sub={`${num(t.new_users_30d)} new in 30 days`} />
          <Tile label="Signed in, last 7 days" value={num(t.active_7d)} sub={`${num(t.active_30d)} in 30 days`} />
          <Tile label="Accounts without a group" value={num(t.users_no_group)} sub={`${num(t.users - t.users_confirmed)} unconfirmed`} />
          <Tile label="Group members" value={num(t.members)} sub={`${num(t.members - t.members_linked)} without an account · ${num(t.guests)} guests`} />
        </div>
      </section>

      <section>
        <h2 className={sectionTitle}>Activity</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Groups" value={num(t.groups)} sub={`${num(t.groups_active_30d)} active in 30 days · ${num(t.new_groups_30d)} new`} />
          <Tile label="Receipts" value={num(t.receipts)} sub={`${num(t.receipts_30d)} in 30 days · ${num(t.items)} items`} />
          <Tile label="Total spend tracked" value={money(t.total_spend)} sub={`${num(t.claims)} claims`} />
          <Tile label="Payments" value={num(t.payments)} sub={`${money(t.payments_total)} settled · ${num(t.gemini_keys)} scan keys`} />
        </div>
      </section>

      <section>
        <h2 className={sectionTitle}>By week</h2>
        <WeeklyChart weekly={data.weekly || []} />
      </section>

      <section>
        <h2 className={sectionTitle}>Groups ({num(data.groups.length)})</h2>
        <GroupsTable groups={data.groups} />
      </section>

      <section>
        <h2 className={sectionTitle}>Accounts ({num(data.users.length)})</h2>
        <UsersTable users={data.users} />
      </section>

      <p className="text-xs text-gray-400">As of {new Date(data.generated_at).toLocaleString()}</p>
    </div>
  )
}
