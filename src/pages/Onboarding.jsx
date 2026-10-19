import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useGroup } from '../lib/group.jsx'
import { useSession } from '../lib/session.jsx'
import { AuthShell, inputClass, primaryButton } from './Auth.jsx'
import BackButton from '../components/BackButton.jsx'
import { useGoBack } from '../lib/useGoBack.js'
import { useDialog } from '../lib/useDialog.jsx'

// Accepts a bare code or a full invite link (…#/join/ABCD2345)
function parseInviteCode(input) {
  const s = input.trim()
  const fromLink = s.match(/join\/([A-Za-z0-9]+)/)
  return (fromLink ? fromLink[1] : s).toUpperCase()
}

// Create a group or join one with a code. Shown when you have no groups,
// and at /groups/new for adding another.
export default function Onboarding() {
  const { memberships, switchGroup, refreshMemberships } = useGroup()
  const { signOut } = useSession()
  const navigate = useNavigate()
  const goBack = useGoBack()
  const [groupName, setGroupName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const hasGroups = memberships.length > 0

  async function create(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const { data, error } = await supabase.rpc('create_group', { p_name: groupName.trim() })
    if (error) { setError(error.message); setBusy(false); return }
    await refreshMemberships()
    switchGroup(data)
    navigate('/group', { replace: true })
  }

  function join(e) {
    e.preventDefault()
    navigate(`/join/${parseInviteCode(code)}`)
  }

  return (
    <AuthShell
      title={hasGroups ? 'Add a group' : 'Set up your group'}
      subtitle="Groups are the people you split receipts with, like your apartment."
    >
      <form onSubmit={create} className="space-y-3">
        <p className="text-sm font-medium text-gray-700">Start a new group</p>
        <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="e.g. 4th Street Apartment" required className={inputClass} />
        <button type="submit" disabled={busy || !groupName.trim()} className={primaryButton}>Create group</button>
      </form>

      <div className="flex items-center gap-3 my-5 text-xs text-gray-400">
        <div className="flex-1 border-t border-gray-200" />or<div className="flex-1 border-t border-gray-200" />
      </div>

      <form onSubmit={join} className="space-y-3">
        <p className="text-sm font-medium text-gray-700">Join with an invite</p>
        <input value={code} onChange={e => setCode(e.target.value)} placeholder="Invite link or code" required className={inputClass} />
        <button type="submit" disabled={!code.trim()} className="w-full py-3 border border-gray-300 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition disabled:opacity-50">
          Join group
        </button>
      </form>

      {error && <p className="text-sm text-red-500 mt-3">{error}</p>}

      <div className="mt-5 text-center text-sm">
        {hasGroups
          ? <BackButton onClick={() => goBack('/')} />
          : <button onClick={signOut} className="text-gray-400 hover:text-gray-600">Sign out</button>}
      </div>
    </AuthShell>
  )
}

// /join/:code — preview the group, then join as an existing person or as new
export function Join() {
  const { code } = useParams()
  const { switchGroup, refreshMemberships } = useGroup()
  const navigate = useNavigate()
  const goBack = useGoBack()
  const [preview, setPreview] = useState(undefined) // undefined = loading, null = invalid
  const { confirm, DialogUI } = useDialog()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const { user, profile, refreshProfile } = useSession()
  // Joining as new would clash with someone's name: show the name form
  const [fixingName, setFixingName] = useState(false)

  const loadPreview = () => supabase.rpc('invite_preview', { p_code: code }).then(({ data }) => { setPreview(data ?? null); return data })

  useEffect(() => {
    loadPreview()
    // The invite has been opened; stop redirecting here on future sign-ins
    if (user.user_metadata?.pending_invite) supabase.auth.updateUser({ data: { pending_invite: null } })
  }, [code])

  // Claiming a person takes over their history, so confirm it's really you
  async function claim(p) {
    const name = `${p.first_name}${p.last_name ? ` ${p.last_name}` : ''}`
    if (!await confirm(`You'll join ${preview.name} as ${name}, with everything already recorded for ${p.first_name}. Only do this if it's you.`, {
      title: `Are you ${name}?`, confirmLabel: `Yes, I'm ${p.first_name}`,
    })) return
    join(p.id)
  }

  async function join(claimMemberId = null) {
    setBusy(true); setError('')
    const { data, error } = await supabase.rpc('join_group', { p_code: code, p_claim_member: claimMemberId })
    if (error?.hint === 'name_clash') {
      // Someone joined with this name meanwhile: ask for a name now
      await loadPreview(); setFixingName(true); setBusy(false); return
    }
    if (error) { setError(error.message); setBusy(false); return }
    await refreshMemberships()
    switchGroup(data)
    navigate('/', { replace: true })
  }

  if (preview === undefined) return <AuthShell><p className="text-sm text-gray-400">Loading…</p></AuthShell>

  if (preview === null) {
    return (
      <AuthShell title="Invite not found" subtitle="This invite link or code isn't valid. It may have been replaced with a new one.">
        <button onClick={() => navigate('/groups/new', { replace: true })} className={primaryButton}>Try another code</button>
      </AuthShell>
    )
  }

  if (preview.already_member) {
    return (
      <AuthShell title={preview.name} subtitle="You're already in this group.">
        <button onClick={() => { switchGroup(preview.group_id); navigate('/', { replace: true }) }} className={primaryButton}>Open {preview.name}</button>
      </AuthShell>
    )
  }

  if (preview.banned) {
    return (
      <AuthShell title={preview.name} subtitle="The owner removed you from this group. Ask them to let you back in.">
        <button onClick={() => goBack('/')} className={primaryButton}>Back</button>
      </AuthShell>
    )
  }

  // Left or was removed before: joining brings back their old person and history
  if (preview.rejoining) {
    return (
      <AuthShell title={`Rejoin ${preview.name}`} subtitle="Welcome back. Your past receipts and payments are still there.">
        <button onClick={() => join()} disabled={busy} className={primaryButton}>{busy ? 'Joining…' : `Rejoin ${preview.name}`}</button>
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      </AuthShell>
    )
  }

  if (fixingName && preview.name_clash) {
    return (
      <NameFix
        clash={preview.name_clash}
        groupName={preview.name}
        profile={profile}
        onCancel={() => setFixingName(false)}
        onSaved={async () => {
          await refreshProfile()
          const next = await loadPreview()
          if (next?.name_clash) return false
          setFixingName(false)
          join()
          return true
        }}
      />
    )
  }

  const people = preview.unclaimed.filter(p => !p.is_guest)
  const guests = preview.unclaimed.filter(p => p.is_guest)
  // Joining as someone new: first make sure the group can tell you apart
  const joinAsNew = () => (preview.name_clash ? setFixingName(true) : join())

  return (
    <AuthShell title={`Join ${preview.name}`} subtitle={preview.unclaimed.length ? 'Are you already in this group?' : null}>
      {DialogUI}
      {preview.unclaimed.length > 0 && (
        <div className="mb-4">
          <p className="text-xs text-gray-400 mb-2">If someone already added you, pick your name to keep your history.</p>
          <div className="flex flex-wrap gap-2">
            {[...people, ...guests].map(p => (
              <button
                key={p.id}
                disabled={busy}
                onClick={() => claim(p)}
                className="px-3 py-1.5 rounded-full border border-gray-300 text-sm text-gray-700 hover:border-accent-400 hover:bg-accent-50 hover:text-accent-700 transition disabled:opacity-50"
              >
                I'm {p.first_name}{p.last_name ? ` ${p.last_name}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}
      <button onClick={joinAsNew} disabled={busy} className={primaryButton}>
        {preview.unclaimed.length ? "I'm new here" : 'Join group'}
      </button>
      {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
      <div className="mt-4 text-center text-sm">
        <button onClick={() => goBack('/')} className="text-gray-400 hover:text-gray-600">Cancel</button>
      </div>
    </AuthShell>
  )
}

// Someone in the group already has your name: add a last name or pick a
// different first name before joining. Saves to your profile (so it's your
// name in every group).
function NameFix({ clash, groupName, profile, onCancel, onSaved }) {
  const [first, setFirst] = useState(profile?.first_name || '')
  const [last, setLast] = useState(profile?.last_name || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const theirs = `${clash.first_name}${clash.last_name ? ` ${clash.last_name}` : ''}`
  const changed = first.trim() !== (profile?.first_name || '') || last.trim() !== (profile?.last_name || '')

  async function save(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.from('profiles').update({ first_name: first.trim(), last_name: last.trim() }).eq('id', profile.id)
    if (error) { setError(error.message); setBusy(false); return }
    // Still clashes: say so here (the form stays open)
    if (!await onSaved()) {
      setError('That name is still taken in this group. Try a different one.')
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="Add your last name"
      subtitle={clash.kind === 'needs_last'
        ? `${groupName} already has someone called ${theirs}. Add your last name so everyone can tell you apart, or use a different first name, like a nickname.`
        : `${groupName} already has someone called ${theirs}. Use a different name, like a nickname or your middle initial, so everyone can tell you apart.`}
    >
      <form onSubmit={save} className="space-y-3">
        <div className="flex gap-2">
          <input value={first} onChange={e => setFirst(e.target.value)} placeholder="First name" required autoComplete="given-name" className={inputClass} />
          <input value={last} onChange={e => setLast(e.target.value)} placeholder="Last name" autoComplete="family-name" autoFocus className={inputClass} />
        </div>
        <p className="text-xs text-gray-400">This changes your name in all your groups. You can change it later in Settings.</p>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button type="submit" disabled={busy || !first.trim() || !changed} className={primaryButton}>{busy ? 'Joining…' : 'Save and join'}</button>
      </form>
      <div className="mt-4 text-center text-sm">
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">Back</button>
      </div>
    </AuthShell>
  )
}
