import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, appBaseUrl } from '../lib/supabase.js'
import { useDialog } from '../lib/useDialog.jsx'
import { useSession } from '../lib/session.jsx'
import { useGroup } from '../lib/group.jsx'

// Used by AddReceipt for receipt scanning: the signed-in user's own key
export async function fetchGeminiKey() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return ''
  const { data } = await supabase.from('user_secrets').select('gemini_api_key').eq('user_id', user.id).maybeSingle()
  return data?.gemini_api_key || ''
}

const card = 'bg-white border border-gray-200 rounded-xl p-4'
const smallInput = 'flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400'
const smallButton = 'px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition text-gray-600 disabled:opacity-50'
const primarySmall = 'px-3 py-1.5 text-sm font-medium bg-accent-600 text-white rounded-lg hover:bg-accent-700 transition disabled:opacity-50'
const sectionTitle = 'text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3'

function Badge({ children, tone = 'gray' }) {
  const tones = {
    gray: 'bg-gray-100 text-gray-500',
    accent: 'bg-accent-50 text-accent-700',
    amber: 'bg-amber-50 text-amber-700',
  }
  return <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${tones[tone]}`}>{children}</span>
}

// ── Group tab ────────────────────────────────────────────────

function GroupInfo() {
  const { group, isOwner, refreshMemberships } = useGroup()
  const { confirm, DialogUI } = useDialog()
  const [name, setName] = useState(group.name)
  const [copied, setCopied] = useState(false)
  const inviteLink = `${appBaseUrl}#/join/${group.invite_code}`

  async function rename() {
    await supabase.from('groups').update({ name: name.trim() }).eq('id', group.id)
    refreshMemberships()
  }

  async function newLink() {
    if (!await confirm('Anyone with the current link or code will no longer be able to join.', {
      title: 'Create a new invite link?', confirmLabel: 'New link',
    })) return
    await supabase.rpc('regenerate_invite', { p_group: group.id })
    refreshMemberships()
  }

  function copy() {
    navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section>
      {DialogUI}
      <div className={`${card} space-y-4`}>
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Group name</p>
          {isOwner ? (
            <div className="flex gap-2">
              <input value={name} onChange={e => setName(e.target.value)} className={smallInput} />
              <button onClick={rename} disabled={!name.trim() || name.trim() === group.name} className={primarySmall}>Save</button>
            </div>
          ) : (
            <p className="text-sm text-gray-800">{group.name}</p>
          )}
        </div>
        <div>
          <p className="text-sm font-medium text-gray-700 mb-0.5">Invite people</p>
          <p className="text-xs text-gray-400 mb-2">Anyone with this link can join the group. Code: <span className="font-mono text-gray-600">{group.invite_code}</span></p>
          <div className="flex gap-2">
            <input readOnly value={inviteLink} onFocus={e => e.target.select()} className={`${smallInput} text-gray-500 bg-gray-50`} />
            <button onClick={copy} className={primarySmall}>{copied ? 'Copied ✓' : 'Copy'}</button>
          </div>
          {isOwner && (
            <button onClick={newLink} className="mt-2 text-xs text-gray-400 hover:text-gray-600">Replace with a new link…</button>
          )}
        </div>
      </div>
    </section>
  )
}

function PersonRow({ m }) {
  const { isOwner, myMember, refreshMembers } = useGroup()
  const { confirm, showAlert, DialogUI } = useDialog()
  const [editing, setEditing] = useState(false)
  const [first, setFirst] = useState(m.first_name)
  const [last, setLast] = useState(m.last_name)
  const [menuOpen, setMenuOpen] = useState(false)
  const isMe = m.id === myMember?.id
  const linked = !!m.user_id

  async function run(fn, args, okMessage) {
    setMenuOpen(false)
    const { error } = await supabase.rpc(fn, args)
    if (error) await showAlert(error.message, { title: 'Something went wrong' })
    else if (okMessage) await showAlert(okMessage)
    refreshMembers()
  }

  async function saveName() {
    const { error } = await supabase.from('group_members').update({ first_name: first.trim(), last_name: last.trim() }).eq('id', m.id)
    if (error) await showAlert(error.message)
    setEditing(false)
    refreshMembers()
  }

  async function toggleGuest() {
    await supabase.from('group_members').update({ is_guest: !m.is_guest }).eq('id', m.id)
    refreshMembers()
  }

  if (editing) {
    return (
      <li className="flex gap-2 py-2">
        <input value={first} onChange={e => setFirst(e.target.value)} placeholder="First name" className={smallInput} autoFocus />
        <input value={last} onChange={e => setLast(e.target.value)} placeholder="Last name" className={smallInput} />
        <button onClick={saveName} disabled={!first.trim()} className={primarySmall}>Save</button>
        <button onClick={() => setEditing(false)} className={smallButton}>Cancel</button>
      </li>
    )
  }

  const ownerActions = isOwner && !isMe ? [
    m.active
      ? ['Remove from group', () => confirm(`${m.displayName} will lose access (if they have an account). Their history stays.`, { title: `Remove ${m.displayName}?`, confirmLabel: 'Remove', danger: true })
          .then(ok => ok && run('remove_member', { p_member: m.id }))]
      : ['Add back to group', () => run('restore_member', { p_member: m.id })],
    linked && m.active && ['Make owner', () => confirm(`${m.displayName} will become the owner. You'll stay in the group as a regular member.`, { title: 'Transfer ownership?', confirmLabel: 'Make owner' })
      .then(ok => ok && run('transfer_ownership', { p_member: m.id }).then(() => window.location.reload()))],
    linked && ['Unlink account', () => confirm(`${m.displayName}'s account will be disconnected from this person. Their history stays here, and they can rejoin with the invite link.`, { title: 'Unlink account?', confirmLabel: 'Unlink', danger: true })
      .then(ok => ok && run('unlink_member', { p_member: m.id }))],
  ].filter(Boolean) : []

  return (
    <li className={`flex items-center gap-3 py-2 ${m.active ? '' : 'opacity-50'}`}>
      {DialogUI}
      <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
        <span className="text-sm text-gray-800">{m.displayName}</span>
        {m.last_name && m.displayName.split(' ').length === 1 && <span className="text-xs text-gray-400">{m.last_name}</span>}
        {isMe && <Badge tone="accent">You</Badge>}
        {m.role === 'owner' && <Badge tone="accent">Owner</Badge>}
        {!m.active && <Badge>Left</Badge>}
        {m.active && m.is_guest && <Badge tone="amber">Guest</Badge>}
        {m.active && !linked && !m.is_guest && <Badge>No account yet</Badge>}
      </div>
      {!linked && m.active && (
        <>
          <button onClick={toggleGuest} className="text-xs text-gray-400 hover:text-gray-600 shrink-0" title="Guests aren't added to new receipts by default">
            {m.is_guest ? 'Make regular' : 'Make guest'}
          </button>
          <button onClick={() => setEditing(true)} className="text-xs text-gray-400 hover:text-gray-600 shrink-0">Rename</button>
        </>
      )}
      {ownerActions.length > 0 && (
        <div className="relative shrink-0">
          <button onClick={() => setMenuOpen(o => !o)} className="px-1.5 text-gray-400 hover:text-gray-600" aria-label="More actions">⋯</button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-20">
              {ownerActions.map(([label, action]) => (
                <button key={label} onClick={() => { setMenuOpen(false); action() }} className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">{label}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function People() {
  const { group, members, refreshMembers } = useGroup()
  const [first, setFirst] = useState('')
  const [asGuest, setAsGuest] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const active = members.filter(m => m.active)
  const inactive = members.filter(m => !m.active)
  const order = m => (m.user_id ? 0 : m.is_guest ? 2 : 1)
  const sorted = [...active].sort((a, b) => order(a) - order(b) || a.displayName.localeCompare(b.displayName))

  async function add(e) {
    e.preventDefault()
    const name = first.trim().replace(/\b\w/g, c => c.toUpperCase())
    if (!name) return
    await supabase.from('group_members').insert({ group_id: group.id, first_name: name, is_guest: asGuest })
    setFirst('')
    refreshMembers()
  }

  return (
    <section>
      <div className={card}>
        <p className="text-sm font-medium text-gray-700 mb-0.5">People</p>
        <p className="text-xs text-gray-400 mb-2">
          Regular people are added to new receipts by default. Guests are for people who join occasionally.
          People without an account can claim their name when they join with the invite link.
        </p>
        <ul className="divide-y divide-gray-100">
          {sorted.map(m => <PersonRow key={m.id} m={m} />)}
          {showInactive && inactive.map(m => <PersonRow key={m.id} m={m} />)}
        </ul>
        {inactive.length > 0 && (
          <button onClick={() => setShowInactive(s => !s)} className="text-xs text-gray-400 hover:text-gray-600 mt-1">
            {showInactive ? 'Hide' : 'Show'} {inactive.length} former member{inactive.length === 1 ? '' : 's'}
          </button>
        )}
        <form onSubmit={add} className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
          <input value={first} onChange={e => setFirst(e.target.value)} placeholder="Add a person…" className={smallInput} />
          <label className="flex items-center gap-1.5 text-xs text-gray-500 shrink-0">
            <input type="checkbox" checked={asGuest} onChange={e => setAsGuest(e.target.checked)} className="accent-accent-600" />
            Guest
          </label>
          <button type="submit" disabled={!first.trim()} className={smallButton}>Add</button>
        </form>
      </div>
    </section>
  )
}

function MergePeople() {
  const { members, refreshMembers } = useGroup()
  const { showAlert, DialogUI } = useDialog()
  const [from, setFrom] = useState('')
  const [into, setInto] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const byId = Object.fromEntries(members.map(m => [m.id, m]))
  const options = [...members].sort((a, b) => a.displayName.localeCompare(b.displayName))

  async function merge() {
    setBusy(true)
    const { error } = await supabase.rpc('merge_members', { p_from: from, p_into: into })
    setBusy(false)
    setConfirming(false)
    if (error) { await showAlert(error.message, { title: 'Could not merge' }); return }
    setDone(`Merged "${byId[from].displayName}" into "${byId[into].displayName}"`)
    setFrom(''); setInto('')
    refreshMembers()
  }

  const select = (value, onChange, placeholder, exclude) => (
    <select
      value={value}
      onChange={e => { onChange(e.target.value); setConfirming(false); setDone('') }}
      className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 bg-white"
    >
      <option value="">{placeholder}</option>
      {options.filter(m => m.id !== exclude).map(m => <option key={m.id} value={m.id}>{m.displayName}{m.active ? '' : ' (left)'}</option>)}
    </select>
  )

  return (
    <section>
      {DialogUI}
      <div className={card}>
        <p className="text-sm font-medium text-gray-700 mb-1">Merge duplicate people</p>
        <p className="text-xs text-gray-400 mb-4">If the same person was added twice (e.g. a typo), move all their history onto one of them.</p>
        <div className="flex items-center gap-2">
          {select(from, setFrom, 'Merge this person…', into)}
          <span className="text-sm text-gray-400 shrink-0">into</span>
          {select(into, setInto, '…this person', from)}
        </div>
        {from && into && !confirming && (
          <button onClick={() => setConfirming(true)} className="mt-3 w-full py-2 text-sm font-medium border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 transition">
            Merge "{byId[from].displayName}" → "{byId[into].displayName}"
          </button>
        )}
        {confirming && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-800 mb-3">All of {byId[from].displayName}'s claims, receipts and payments will move to {byId[into].displayName}. This is recorded in the history.</p>
            <div className="flex gap-2">
              <button onClick={merge} disabled={busy} className="flex-1 py-1.5 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition disabled:opacity-50">
                {busy ? 'Merging…' : 'Yes, merge'}
              </button>
              <button onClick={() => setConfirming(false)} className={smallButton}>Cancel</button>
            </div>
          </div>
        )}
        {done && <p className="mt-3 text-sm text-accent-600 font-medium">{done} ✓</p>}
      </div>
    </section>
  )
}

function LeaveGroup() {
  const { group, refreshMemberships } = useGroup()
  const { confirm, showAlert, DialogUI } = useDialog()
  const navigate = useNavigate()

  async function leave() {
    if (!await confirm(`You'll lose access to ${group.name}. Your history stays, and you can rejoin with an invite link.`, {
      title: `Leave ${group.name}?`, confirmLabel: 'Leave', danger: true,
    })) return
    const { error } = await supabase.rpc('leave_group', { p_group: group.id })
    if (error) { await showAlert(error.message, { title: 'Could not leave' }); return }
    await refreshMemberships()
    navigate('/')
  }

  return (
    <section>
      {DialogUI}
      <button onClick={leave} className="w-full py-2 text-sm font-medium border border-red-200 text-red-500 rounded-xl hover:bg-red-50 transition">
        Leave {group.name}
      </button>
    </section>
  )
}

// ── Personal tab ─────────────────────────────────────────────

function YourName() {
  const { profile, refreshProfile } = useSession()
  const { refreshMembers } = useGroup()
  const [first, setFirst] = useState(profile.first_name)
  const [last, setLast] = useState(profile.last_name)
  const [saved, setSaved] = useState(false)
  const changed = first.trim() !== profile.first_name || last.trim() !== profile.last_name

  async function save() {
    await supabase.from('profiles').update({ first_name: first.trim(), last_name: last.trim() }).eq('id', profile.id)
    await refreshProfile()
    await refreshMembers()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <section>
      <h2 className={sectionTitle}>Your name</h2>
      <div className={card}>
        <div className="flex gap-2">
          <input value={first} onChange={e => setFirst(e.target.value)} placeholder="First name" className={smallInput} />
          <input value={last} onChange={e => setLast(e.target.value)} placeholder="Last name" className={smallInput} />
          <button onClick={save} disabled={!first.trim() || !changed} className={primarySmall}>{saved ? 'Saved ✓' : 'Save'}</button>
        </div>
        <p className="text-xs text-gray-400 mt-2">Shown by first name. If two people in a group share a first name, a last initial is added.</p>
      </div>
    </section>
  )
}

function Account() {
  const { user, signOut } = useSession()
  const [sent, setSent] = useState(false)

  async function resetPassword() {
    await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: appBaseUrl })
    setSent(true)
  }

  return (
    <section>
      <h2 className={sectionTitle}>Account</h2>
      <div className={`${card} space-y-3`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-gray-800 truncate">{user.email}</p>
            <p className="text-xs text-gray-400">{user.app_metadata?.provider === 'google' ? 'Signed in with Google' : 'Email and password'}</p>
          </div>
          <button onClick={signOut} className={smallButton}>Sign out</button>
        </div>
        {user.app_metadata?.provider !== 'google' && (
          <button onClick={resetPassword} disabled={sent} className="text-xs text-gray-400 hover:text-gray-600 disabled:text-accent-600">
            {sent ? `Password reset link sent to ${user.email}` : 'Change password…'}
          </button>
        )}
      </div>
    </section>
  )
}

function GeminiKey() {
  const { user } = useSession()
  const { confirm, DialogUI } = useDialog()
  const [key, setKey] = useState(null) // null = loading
  const [replacing, setReplacing] = useState(false)
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchGeminiKey().then(setKey) }, [])

  async function save() {
    setSaving(true)
    await supabase.from('user_secrets').upsert({ user_id: user.id, gemini_api_key: input.trim(), updated_at: new Date().toISOString() })
    setKey(input.trim())
    setInput(''); setReplacing(false); setSaving(false)
  }

  async function remove() {
    if (!await confirm('Receipt scanning will stop working for you until you add a new key.', {
      title: 'Delete your API key?', confirmLabel: 'Delete', danger: true,
    })) return
    await supabase.from('user_secrets').upsert({ user_id: user.id, gemini_api_key: null, updated_at: new Date().toISOString() })
    setKey(''); setReplacing(false)
  }

  return (
    <section>
      {DialogUI}
      <h2 className={sectionTitle}>Receipt scanning</h2>
      <div className={card}>
        <p className="text-sm font-medium text-gray-700 mb-0.5">Your Gemini API key</p>
        <p className="text-xs text-gray-400 mb-3">
          Scanning reads receipt photos with Google's Gemini AI, using your own free key. Only you can see it.
          Get one at{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-accent-600 hover:underline">aistudio.google.com/apikey</a>.
        </p>
        {key === null ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : key && !replacing ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-sm text-gray-400 tracking-widest select-none">••••••••••••{key.slice(-4)}</div>
            <button onClick={() => { setReplacing(true); setInput('') }} className={smallButton}>Replace</button>
            <button onClick={remove} className="px-3 py-1.5 text-sm border border-red-200 rounded-lg text-red-500 hover:bg-red-50 transition">Delete</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && input.trim() && save()}
              placeholder="Paste API key…"
              autoComplete="off"
              className={smallInput}
            />
            <button onClick={save} disabled={!input.trim() || saving} className={primarySmall}>{saving ? 'Saving…' : 'Save'}</button>
            {replacing && <button onClick={() => setReplacing(false)} className={smallButton}>Cancel</button>}
          </div>
        )}
      </div>
    </section>
  )
}

function Preferences() {
  const [defaultShowAll, setDefaultShowAll] = useState(localStorage.getItem('default-show-all-trips') === '1')
  useEffect(() => {
    localStorage.setItem('default-show-all-trips', defaultShowAll ? '1' : '0')
  }, [defaultShowAll])

  return (
    <section>
      <h2 className={`${sectionTitle} mb-1`}>Preferences</h2>
      <p className="text-xs text-gray-400 mb-3">Saved on this device only.</p>
      <div className={card}>
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <p className="text-sm font-medium text-gray-800">Show all receipts by default</p>
            <p className="text-xs text-gray-400 mt-0.5">When off, only receipts you're a member of are shown on the home page</p>
          </div>
          <button
            onClick={() => setDefaultShowAll(v => !v)}
            className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ml-4 ${defaultShowAll ? 'bg-accent-500' : 'bg-gray-200'}`}
          >
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${defaultShowAll ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </label>
      </div>
    </section>
  )
}

export default function Settings() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'personal' ? 'personal' : 'group'

  return (
    <div className="max-w-xl mx-auto p-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5 select-none">
          {[['group', 'Group'], ['personal', 'Personal']].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setParams({ tab: v }, { replace: true })}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                tab === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        {tab === 'group' ? (
          <>
            <GroupInfo />
            <People />
            <MergePeople />
            <LeaveGroup />
          </>
        ) : (
          <>
            <YourName />
            <Account />
            <GeminiKey />
            <Preferences />
          </>
        )}
      </div>
    </div>
  )
}
