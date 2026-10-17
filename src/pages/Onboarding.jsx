import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useGroup } from '../lib/group.jsx'
import { useSession } from '../lib/session.jsx'
import { AuthShell, inputClass, primaryButton } from './Auth.jsx'

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
    navigate('/settings?tab=group')
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
          ? <button onClick={() => navigate('/')} className="text-gray-400 hover:text-gray-600">← Back</button>
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
  const [preview, setPreview] = useState(undefined) // undefined = loading, null = invalid
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const { user } = useSession()

  useEffect(() => {
    supabase.rpc('invite_preview', { p_code: code }).then(({ data }) => setPreview(data ?? null))
    // The invite has been opened; stop redirecting here on future sign-ins
    if (user.user_metadata?.pending_invite) supabase.auth.updateUser({ data: { pending_invite: null } })
  }, [code])

  async function join(claimMemberId = null) {
    setBusy(true); setError('')
    const { data, error } = await supabase.rpc('join_group', { p_code: code, p_claim_member: claimMemberId })
    if (error) { setError(error.message); setBusy(false); return }
    await refreshMemberships()
    switchGroup(data)
    navigate('/')
  }

  if (preview === undefined) return <AuthShell><p className="text-sm text-gray-400">Loading…</p></AuthShell>

  if (preview === null) {
    return (
      <AuthShell title="Invite not found" subtitle="This invite link or code isn't valid. It may have been replaced with a new one.">
        <button onClick={() => navigate('/groups/new')} className={primaryButton}>Try another code</button>
      </AuthShell>
    )
  }

  if (preview.already_member) {
    return (
      <AuthShell title={preview.name} subtitle="You're already in this group.">
        <button onClick={() => { switchGroup(preview.group_id); navigate('/') }} className={primaryButton}>Open {preview.name}</button>
      </AuthShell>
    )
  }

  const people = preview.unclaimed.filter(p => !p.is_guest)
  const guests = preview.unclaimed.filter(p => p.is_guest)

  return (
    <AuthShell title={`Join ${preview.name}`} subtitle={preview.unclaimed.length ? 'Are you already in this group?' : null}>
      {preview.unclaimed.length > 0 && (
        <div className="mb-4">
          <p className="text-xs text-gray-400 mb-2">If someone already added you, pick your name to keep your history.</p>
          <div className="flex flex-wrap gap-2">
            {[...people, ...guests].map(p => (
              <button
                key={p.id}
                disabled={busy}
                onClick={() => join(p.id)}
                className="px-3 py-1.5 rounded-full border border-gray-300 text-sm text-gray-700 hover:border-accent-400 hover:bg-accent-50 hover:text-accent-700 transition disabled:opacity-50"
              >
                I'm {p.first_name}{p.last_name ? ` ${p.last_name}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}
      <button onClick={() => join()} disabled={busy} className={primaryButton}>
        {preview.unclaimed.length ? "I'm new here" : 'Join group'}
      </button>
      {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
      <div className="mt-4 text-center text-sm">
        <button onClick={() => navigate('/')} className="text-gray-400 hover:text-gray-600">Cancel</button>
      </div>
    </AuthShell>
  )
}
