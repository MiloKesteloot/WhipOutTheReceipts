import { Fragment, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, appBaseUrl } from '../lib/supabase.js'
import { useDialog } from '../lib/useDialog.jsx'
import { useGroup } from '../lib/group.jsx'
import { copyText } from '../lib/clipboard.js'
import { invalidateSearch } from '../lib/search.jsx'
import { useDismiss } from '../lib/useDismiss.js'
import { useGoBack } from '../lib/useGoBack.js'
import { POPUP_PANEL, POPUP_ITEM, POPUP_ITEM_DANGER, POPUP_DIVIDER, opensUp, popupHeight } from '../lib/popup.js'
import { FIELD } from '../lib/ui.js'
import Select from '../components/Select.jsx'
import BackButton from '../components/BackButton.jsx'
import StableLabel from '../components/StableLabel.jsx'
import { DotsIcon } from '../components/Icons.jsx'

const card = 'bg-white border border-gray-200 rounded-xl p-4'
// Fields in a row with buttons: the field shrinks, the buttons match its height
const rowInput = `${FIELD} flex-1 min-w-0`
const readOnlyInput = `${rowInput} !text-gray-500 !bg-gray-50`
const buttonBase = 'inline-flex items-center justify-center shrink-0 h-11 sm:h-10 px-3 text-sm rounded-lg transition disabled:opacity-50'
const smallButton = `${buttonBase} border border-gray-200 text-gray-600 hover:bg-gray-50 active:bg-gray-100`
const primarySmall = `${buttonBase} font-medium bg-accent-600 text-white hover:bg-accent-700 active:bg-accent-700`
// Text-only buttons: a bigger tap area than the text, without moving anything
const textLink = 'py-2 -my-2 text-xs text-gray-400 hover:text-gray-600 active:text-gray-600'

function Badge({ children, tone = 'gray' }) {
  const tones = {
    gray: 'bg-gray-100 text-gray-500',
    accent: 'bg-accent-50 text-accent-700',
    amber: 'bg-amber-50 text-amber-700',
  }
  return <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${tones[tone]}`}>{children}</span>
}

// ── Group settings ────────────────────────────────────────────────

function GroupInfo() {
  const { group, isOwner, refreshMemberships } = useGroup()
  const { confirm, showAlert, DialogUI } = useDialog()
  const [name, setName] = useState(group.name)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const inviteLink = `${appBaseUrl}#/join/${group.invite_code}`

  async function rename(e) {
    e.preventDefault()
    // Enter on an unchanged name, or a double tap, does nothing
    if (saving || !name.trim() || name.trim() === group.name) return
    setSaving(true)
    const { error } = await supabase.from('groups').update({ name: name.trim() }).eq('id', group.id)
    if (error) await showAlert(error.message, { title: 'Could not rename the group' })
    await refreshMemberships()
    setSaving(false)
    if (!error) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  async function newLink() {
    if (!await confirm('Anyone with the current link or code will no longer be able to join.', {
      title: 'Create a new invite link?', confirmLabel: 'New link',
    })) return
    const { error } = await supabase.rpc('regenerate_invite', { p_group: group.id })
    if (error) await showAlert(error.message, { title: 'Could not make a new link' })
    refreshMemberships()
  }

  async function copy() {
    if (!await copyText(inviteLink)) { await showAlert(inviteLink, { title: 'Copy this link' }); return }
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
            <form onSubmit={rename} className="flex gap-2">
              <input value={name} onChange={e => setName(e.target.value)} aria-label="Group name" autoComplete="off" className={rowInput} />
              <button type="submit" disabled={saving || !name.trim() || name.trim() === group.name} className={primarySmall}>
                <StableLabel current={saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'} labels={['Save', 'Saving…', 'Saved ✓']} />
              </button>
            </form>
          ) : (
            <p className="text-sm text-gray-800">{group.name}</p>
          )}
        </div>
        <div>
          <p className="text-sm font-medium text-gray-700 mb-0.5">Invite people</p>
          <p className="text-xs text-gray-400 mb-2">Anyone with this link can join the group. Code: <span className="font-mono text-gray-600">{group.invite_code}</span></p>
          <div className="flex gap-2">
            <input readOnly value={inviteLink} onFocus={e => e.target.select()} aria-label="Invite link" className={readOnlyInput} />
            <button onClick={copy} className={primarySmall}><StableLabel current={copied ? 'Copied ✓' : 'Copy'} labels={['Copy', 'Copied ✓']} /></button>
          </div>
          {isOwner && (
            <button onClick={newLink} className={`${textLink} mt-0`}>Replace with a new link…</button>
          )}
        </div>
      </div>
    </section>
  )
}

// A secret link that lets someone without an account check off their own
// items (pages/Guest.jsx). "New link" stops the old one from working.
export function guestLinkUrl(token) {
  return `${appBaseUrl}#/guest/${token}`
}

function GuestLinkPanel({ m, onClose }) {
  const { refreshMembers } = useGroup()
  const { confirm, showAlert, DialogUI } = useDialog()
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const link = m.guest_token ? guestLinkUrl(m.guest_token) : ''

  async function create(replacing) {
    if (replacing && !await confirm(`The current link will stop working for ${m.displayName}.`, { title: 'Make a new link?', confirmLabel: 'New link' })) return
    setBusy(true)
    const { error } = await supabase.rpc('guest_link_create', { p_member: m.id })
    setBusy(false)
    if (error) { await showAlert(error.message, { title: 'Could not make a link' }); return }
    refreshMembers()
  }

  async function copy() {
    if (!await copyText(link)) { await showAlert(link, { title: 'Copy this link' }); return }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <li className="py-2 pl-3 border-l-2 border-accent-200 ml-1 mb-2">
      {DialogUI}
      <p className="text-xs text-gray-500 mb-2">
        Send this to {m.displayName} so they can check off what they had, without making an account. Anyone with the link can check off items as {m.displayName}.
      </p>
      {link ? (
        <>
          <div className="flex gap-2">
            <input readOnly value={link} onFocus={e => e.target.select()} aria-label={`Guest link for ${m.displayName}`} className={readOnlyInput} />
            <button onClick={copy} className={primarySmall}><StableLabel current={copied ? 'Copied ✓' : 'Copy'} labels={['Copy', 'Copied ✓']} /></button>
          </div>
          <div className="mt-2 flex gap-4">
            <button onClick={() => create(true)} disabled={busy} className={textLink}>Replace with a new link…</button>
            <button onClick={onClose} className={textLink}>Done</button>
          </div>
        </>
      ) : (
        <div className="flex gap-2">
          <button onClick={() => create(false)} disabled={busy} className={primarySmall}>
            <StableLabel current={busy ? 'Making link…' : 'Make a guest link'} labels={['Make a guest link', 'Making link…']} />
          </button>
          <button onClick={onClose} className={smallButton}>Cancel</button>
        </div>
      )}
    </li>
  )
}

function PersonRow({ m }) {
  const { isOwner, myMember, refreshMembers } = useGroup()
  const { confirm, showAlert, DialogUI } = useDialog()
  const [editing, setEditing] = useState(false)
  const [first, setFirst] = useState(m.first_name)
  const [last, setLast] = useState(m.last_name)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuUp, setMenuUp] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const menuRef = useRef(null)
  const isMe = m.id === myMember?.id
  const linked = !!m.user_id

  // The ⋯ menu closes on a tap anywhere else (including another row's ⋯) or Escape
  useDismiss(menuOpen, menuRef, () => setMenuOpen(false))

  // Rename starts from the current name (not what was typed and cancelled last time)
  function startRename() {
    setFirst(m.first_name)
    setLast(m.last_name)
    setEditing(true)
  }

  async function run(fn, args, okMessage) {
    setMenuOpen(false)
    const { error } = await supabase.rpc(fn, args)
    if (error) await showAlert(error.message, { title: 'Something went wrong' })
    else if (okMessage) await showAlert(okMessage)
    refreshMembers()
    return !error
  }

  async function saveName(e) {
    e.preventDefault()
    if (saving || !first.trim()) return
    setSaving(true)
    const { error } = await supabase.from('group_members').update({ first_name: first.trim(), last_name: last.trim() }).eq('id', m.id)
    setSaving(false)
    // On error, stay in the form so the typed name isn't lost
    if (error) { await showAlert(error.message, { title: 'Could not rename' }); return }
    setEditing(false)
    refreshMembers()
  }

  async function toggleGuest() {
    const { error } = await supabase.from('group_members').update({ is_guest: !m.is_guest }).eq('id', m.id)
    if (error) await showAlert(error.message)
    refreshMembers()
  }

  if (editing) {
    return (
      <li className="py-2">
        {DialogUI}
        {/* Phones: the names on one line, the buttons under them */}
        <form onSubmit={saveName} className="flex flex-wrap sm:flex-nowrap gap-2">
          <div className="flex gap-2 w-full sm:w-auto sm:flex-1 min-w-0">
            <input value={first} onChange={e => setFirst(e.target.value)} placeholder="First name" aria-label="First name" autoCapitalize="words" autoComplete="off" className={rowInput} autoFocus />
            <input value={last} onChange={e => setLast(e.target.value)} placeholder="Last name" aria-label="Last name" autoCapitalize="words" autoComplete="off" className={rowInput} />
          </div>
          <div className="flex gap-2 ml-auto">
            <button type="submit" disabled={saving || !first.trim()} className={primarySmall}>
              <StableLabel current={saving ? 'Saving…' : 'Save'} labels={['Save', 'Saving…']} />
            </button>
            <button type="button" onClick={() => setEditing(false)} className={smallButton}>Cancel</button>
          </div>
        </form>
      </li>
    )
  }

  // [label, action, danger]. Removing, banning and unlinking are
  // destructive, so they go last, under a line, in red.
  const owner = isOwner && !isMe
  const ownerActions = owner ? [
    m.banned && ['Unban', () => run('unban_member', { p_member: m.id }, `${m.displayName} can rejoin with the invite link.`)],
    !m.active && ['Add back to group', () => run('restore_member', { p_member: m.id })],
    linked && m.active && ['Make owner', () => confirm(`${m.displayName} will become the owner. You'll stay in the group as a regular member.`, { title: 'Transfer ownership?', confirmLabel: 'Make owner' })
      .then(ok => ok && run('transfer_ownership', { p_member: m.id }).then(done => done && window.location.reload()))],
  ].filter(Boolean) : []
  const dangerActions = owner ? [
    m.active && ['Remove from group', () => confirm(
      linked
        ? `${m.displayName} will lose access, but can rejoin with the invite link. Their history stays.`
        : `${m.displayName} won't be offered on new receipts. Their history stays.`,
      { title: `Remove ${m.displayName}?`, confirmLabel: 'Remove', danger: true })
      .then(ok => ok && run('remove_member', { p_member: m.id })), true],
    // A ban only matters for someone with an account: it keeps the invite from letting them back in
    linked && !m.banned && ['Ban from group', () => confirm(`${m.displayName} will lose access and can't rejoin with the invite link until you unban them. Their history stays.`, { title: `Ban ${m.displayName}?`, confirmLabel: 'Ban', danger: true })
      .then(ok => ok && run('remove_member', { p_member: m.id, p_ban: true })), true],
    // Unlinking a banned person would let their account join as someone new
    linked && !m.banned && ['Unlink account', () => confirm(`${m.displayName}'s account will be disconnected from this person. Their history stays here, and they can rejoin with the invite link.`, { title: 'Unlink account?', confirmLabel: 'Unlink', danger: true })
      .then(ok => ok && run('unlink_member', { p_member: m.id })), true],
  ].filter(Boolean) : []

  // Anyone in the group can rename people without an account or switch them
  // between regular and guest; those go in the ⋯ menu too
  const menuActions = [
    ...(!linked && m.active ? [
      ['Rename', startRename],
      [m.is_guest ? 'Make regular' : 'Make guest', toggleGuest],
    ] : []),
    ...ownerActions,
    ...dangerActions,
  ]
  // A line between the neutral and the destructive ones, when there are both
  const dividerAt = dangerActions.length && menuActions.length > dangerActions.length ? menuActions.length - dangerActions.length : -1

  return (
    <>
    {DialogUI}
    <li className={`flex items-center gap-3 py-2 ${m.active ? '' : 'opacity-50'}`}>
      <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
        <span className="text-sm text-gray-800">{m.displayName}</span>
        {m.last_name && m.displayName.split(' ').length === 1 && <span className="text-xs text-gray-400">{m.last_name}</span>}
        {isMe && <Badge tone="accent">You</Badge>}
        {m.role === 'owner' && <Badge tone="accent">Owner</Badge>}
        {m.banned ? <Badge tone="amber">Banned</Badge> : !m.active && <Badge>Left</Badge>}
        {m.active && m.is_guest && <Badge tone="amber">Guest</Badge>}
        {m.active && !linked && !m.is_guest && <Badge>No account yet</Badge>}
      </div>
      {!linked && m.active && (
        <button onClick={() => setLinkOpen(o => !o)} className="py-2 -my-2 px-1 -mx-1 text-xs text-accent-600 hover:text-accent-700 active:text-accent-700 shrink-0">Guest link</button>
      )}
      {menuActions.length > 0 && (
        <div ref={menuRef} className="relative shrink-0">
          <button
            onClick={() => {
              // Near the bottom of a phone screen, open upward (clear of the tab bar)
              if (!menuOpen) setMenuUp(opensUp(menuRef.current, popupHeight(menuActions.length + (dividerAt > 0 ? 1 : 0))))
              setMenuOpen(o => !o)
            }}
            // A 36px target; the negative margins keep the row from growing
            className={`w-9 h-9 -my-1.5 -mr-1.5 flex items-center justify-center rounded-lg transition-colors ${menuOpen ? 'bg-gray-100 text-gray-600' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 active:bg-gray-100'}`}
            aria-label={`More actions for ${m.displayName}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          ><DotsIcon /></button>
          {menuOpen && (
            <div role="menu" className={`absolute right-0 w-44 z-20 ${menuUp ? 'bottom-full mb-1 animate-pop-up' : 'top-full mt-1 animate-pop'} ${POPUP_PANEL}`}>
              {menuActions.map(([label, action, danger], i) => (
                <Fragment key={label}>
                  {i === dividerAt && <div role="separator" className={POPUP_DIVIDER} />}
                  <button role="menuitem" onClick={() => { setMenuOpen(false); action() }} className={danger ? POPUP_ITEM_DANGER : `${POPUP_ITEM} text-gray-700`}>{label}</button>
                </Fragment>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
    {linkOpen && <GuestLinkPanel m={m} onClose={() => setLinkOpen(false)} />}
    </>
  )
}

function People() {
  const { group, members, refreshMembers } = useGroup()
  const { showAlert, DialogUI } = useDialog()
  const [first, setFirst] = useState('')
  const [asGuest, setAsGuest] = useState(false)
  const [adding, setAdding] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const active = members.filter(m => m.active)
  const inactive = members.filter(m => !m.active)
  const order = m => (m.user_id ? 0 : m.is_guest ? 2 : 1)
  const sorted = [...active].sort((a, b) => order(a) - order(b) || a.displayName.localeCompare(b.displayName))

  async function add(e) {
    e.preventDefault()
    const name = first.trim().replace(/\b\w/g, c => c.toUpperCase())
    // A quick double tap shouldn't add them twice
    if (!name || adding) return
    setAdding(true)
    const { error } = await supabase.from('group_members').insert({ group_id: group.id, first_name: name, is_guest: asGuest })
    setAdding(false)
    if (error) { await showAlert(error.message, { title: 'Could not add that person' }); return }
    setFirst('')
    refreshMembers()
  }

  return (
    <section>
      {DialogUI}
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
          <button onClick={() => setShowInactive(s => !s)} className={`${textLink} -mt-1`}>
            {showInactive ? 'Hide' : 'Show'} {inactive.length} former member{inactive.length === 1 ? '' : 's'}
            {inactive.some(m => m.banned) && ` (${inactive.filter(m => m.banned).length} banned)`}
          </button>
        )}
        <form onSubmit={add} className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
          <input value={first} onChange={e => setFirst(e.target.value)} placeholder="Add a person…" aria-label="Add a person" autoCapitalize="words" autoComplete="off" className={rowInput} />
          <label className="flex items-center gap-1.5 text-xs text-gray-500 shrink-0">
            <input type="checkbox" checked={asGuest} onChange={e => setAsGuest(e.target.checked)} className="accent-accent-600" />
            Guest
          </label>
          <button type="submit" disabled={!first.trim() || adding} className={primarySmall}>Add</button>
        </form>
      </div>
    </section>
  )
}

function MergePeople() {
  const { group, members, refreshMembers } = useGroup()
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
    invalidateSearch(group.id)
    setDone(`Merged "${byId[from].displayName}" into "${byId[into].displayName}"`)
    setFrom(''); setInto('')
    refreshMembers()
  }

  const select = (value, onChange, placeholder, exclude) => (
    <Select
      small
      className="w-full sm:w-auto sm:flex-1 min-w-0"
      value={value}
      onChange={v => { onChange(v); setConfirming(false); setDone('') }}
      placeholder={placeholder}
      ariaLabel={placeholder}
      options={options.filter(m => m.id !== exclude).map(m => ({ value: m.id, label: `${m.displayName}${m.active ? '' : ' (left)'}` }))}
    />
  )

  return (
    <section>
      {DialogUI}
      <div className={card}>
        <p className="text-sm font-medium text-gray-700 mb-1">Merge duplicate people</p>
        <p className="text-xs text-gray-400 mb-4">If the same person was added twice (e.g. a typo), move all their history onto one of them.</p>
        {/* Stacked on phones, where side by side cuts off the names */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          {select(from, setFrom, 'Merge this person…', into)}
          <span className="text-sm text-gray-400 shrink-0 pl-1 sm:pl-0">into</span>
          {select(into, setInto, '…this person', from)}
        </div>
        {from && into && !confirming && (
          <button onClick={() => setConfirming(true)} className="mt-3 w-full py-2 text-sm font-medium border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 active:bg-amber-50 transition">
            Merge "{byId[from].displayName}" → "{byId[into].displayName}"
          </button>
        )}
        {confirming && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-800 mb-3">
              All of {byId[from].displayName}'s check-offs, receipts and payments will move to {byId[into].displayName}; payments between the two of them are removed.
              {byId[from].user_id && ` ${byId[from].displayName}'s account moves to ${byId[into].displayName} too.`} This is recorded in the history.
            </p>
            <div className="flex gap-2">
              <button onClick={merge} disabled={busy} className={`${buttonBase} flex-1 font-medium bg-amber-600 text-white hover:bg-amber-700 active:bg-amber-700`}>
                <StableLabel current={busy ? 'Merging…' : 'Yes, merge'} labels={['Yes, merge', 'Merging…']} />
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
    // The left group's settings page is gone: Back shouldn't return to it
    navigate('/', { replace: true })
  }

  return (
    <section>
      {DialogUI}
      <button onClick={leave} className="w-full py-2 text-sm font-medium border border-red-200 text-red-500 rounded-xl hover:bg-red-50 active:bg-red-50 transition">
        Leave {group.name}
      </button>
    </section>
  )
}

export default function GroupSettings() {
  const { group, isOwner } = useGroup()
  const goBack = useGoBack()
  return (
    <div className="max-w-xl mx-auto p-4 py-8">
      {/* Only reachable from the account menu: no tab leads back */}
      <BackButton onClick={() => goBack('/')} className="mb-2" />
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{group.name}</h1>
      <div className="space-y-6">
        <GroupInfo />
        <People />
        {/* Merging can move someone's account and history, so it's owner only */}
        {isOwner && <MergePeople />}
        <LeaveGroup />
      </div>
    </div>
  )
}
