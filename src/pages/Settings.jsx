import { useEffect, useState } from 'react'
import { supabase, appBaseUrl } from '../lib/supabase.js'
import { useDialog } from '../lib/useDialog.jsx'
import { useSession } from '../lib/session.jsx'
import { useGroup } from '../lib/group.jsx'
import { useGoBack } from '../lib/useGoBack.js'
import { FIELD } from '../lib/ui.js'
import BackButton from '../components/BackButton.jsx'
import StableLabel from '../components/StableLabel.jsx'

// Used by AddReceipt for receipt scanning: the signed-in user's own key.
// Throws if it can't be read, so a failed load isn't taken for "no key yet".
export async function fetchGeminiKey() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return ''
  const { data, error } = await supabase.from('user_secrets').select('gemini_api_key').eq('user_id', user.id).maybeSingle()
  if (error) throw error
  return data?.gemini_api_key || ''
}

const card = 'bg-white border border-gray-200 rounded-xl p-4'
// Fields in a row with buttons: the field shrinks, the buttons match its height
const rowInput = `${FIELD} flex-1 min-w-0`
const buttonBase = 'inline-flex items-center justify-center shrink-0 h-11 sm:h-10 px-3 text-sm rounded-lg transition disabled:opacity-50'
const smallButton = `${buttonBase} border border-gray-200 text-gray-600 hover:bg-gray-50 active:bg-gray-100`
const primarySmall = `${buttonBase} font-medium bg-accent-600 text-white hover:bg-accent-700 active:bg-accent-700`
const dangerSmall = `${buttonBase} border border-red-200 text-red-500 hover:bg-red-50 active:bg-red-50`
const sectionTitle = 'text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3'

// ── Personal tab ─────────────────────────────────────────────

function YourName() {
  const { profile, refreshProfile } = useSession()
  const { refreshMembers } = useGroup()
  const { showAlert, DialogUI } = useDialog()
  const [first, setFirst] = useState(profile.first_name)
  const [last, setLast] = useState(profile.last_name)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const changed = first.trim() !== profile.first_name || last.trim() !== profile.last_name

  async function save(e) {
    e.preventDefault()
    // Enter with nothing changed, or a double tap, does nothing
    if (saving || !first.trim() || !changed) return
    setSaving(true)
    const { error } = await supabase.from('profiles').update({ first_name: first.trim(), last_name: last.trim() }).eq('id', profile.id)
    if (error) { setSaving(false); await showAlert(error.message, { title: 'Could not save your name' }); return }
    await refreshProfile()
    await refreshMembers()
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <section>
      {DialogUI}
      <h2 className={sectionTitle}>Your name</h2>
      <div className={card}>
        <form onSubmit={save} className="flex gap-2">
          <input value={first} onChange={e => setFirst(e.target.value)} placeholder="First name" aria-label="First name" autoComplete="given-name" className={rowInput} />
          <input value={last} onChange={e => setLast(e.target.value)} placeholder="Last name" aria-label="Last name" autoComplete="family-name" className={rowInput} />
          <button type="submit" disabled={saving || !first.trim() || !changed} className={primarySmall}>
            <StableLabel current={saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'} labels={['Save', 'Saving…', 'Saved ✓']} />
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-2">Shown by first name. If two people in a group share a first name, a last initial is added.</p>
      </div>
    </section>
  )
}

function Account() {
  const { user, signOut } = useSession()
  const { confirm, showAlert, DialogUI } = useDialog()
  const [sent, setSent] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Runs delete_my_account() in the database (migration 20261018010000)
  async function deleteAccount() {
    if (!await confirm(
      "Your login, profile and saved API key are deleted, and you leave every group. Your name stays on past receipts and payments in shared groups (and in their history), so your roommates' balances don't change. Groups where nobody else has an account are deleted entirely. This can't be undone.",
      { title: 'Delete your account?', confirmLabel: 'Delete account', danger: true },
    )) return
    setDeleting(true)
    const { error } = await supabase.rpc('delete_my_account')
    if (error) {
      setDeleting(false)
      await showAlert(error.message, { title: 'Could not delete account' })
      return
    }
    await supabase.auth.signOut({ scope: 'local' })
    // Replace, so Back doesn't return to the deleted account's settings
    window.location.replace(window.location.pathname + '#/')
  }

  async function resetPassword() {
    // Fails e.g. when asked again within a minute (Supabase's rate limit)
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: appBaseUrl })
    if (error) { await showAlert(error.message, { title: 'Could not send the reset link' }); return }
    setSent(true)
  }

  return (
    <section>
      {DialogUI}
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
          <button onClick={resetPassword} disabled={sent} className="py-2 -my-2 text-left text-xs text-gray-400 hover:text-gray-600 active:text-gray-600 disabled:text-accent-600">
            {sent ? `Password reset link sent to ${user.email}` : 'Change password…'}
          </button>
        )}
        <div className="pt-3 border-t border-gray-100 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-400">Permanently delete your account. Your name stays on shared receipts.</p>
          <button onClick={deleteAccount} disabled={deleting} className={dangerSmall}>
            <StableLabel current={deleting ? 'Deleting…' : 'Delete account'} labels={['Delete account', 'Deleting…']} />
          </button>
        </div>
      </div>
    </section>
  )
}

function GeminiKey() {
  const { user } = useSession()
  const { confirm, showAlert, DialogUI } = useDialog()
  const [key, setKey] = useState(null) // null = loading
  const [loadError, setLoadError] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)

  function load() {
    setLoadError('')
    fetchGeminiKey().then(setKey, e => setLoadError(e.message || 'Could not load your key'))
  }
  useEffect(load, [])

  async function save(e) {
    e.preventDefault()
    if (saving || !input.trim()) return
    setSaving(true)
    const { error } = await supabase.from('user_secrets').upsert({ user_id: user.id, gemini_api_key: input.trim(), updated_at: new Date().toISOString() })
    if (error) { setSaving(false); await showAlert(error.message, { title: 'Could not save your key' }); return }
    setKey(input.trim())
    setInput(''); setReplacing(false); setSaving(false)
  }

  async function remove() {
    if (!await confirm('Receipt scanning will stop working for you until you add a new key.', {
      title: 'Delete your API key?', confirmLabel: 'Delete', danger: true,
    })) return
    const { error } = await supabase.from('user_secrets').upsert({ user_id: user.id, gemini_api_key: null, updated_at: new Date().toISOString() })
    if (error) { await showAlert(error.message, { title: 'Could not delete your key' }); return }
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
        {loadError ? (
          <div className="h-11 sm:h-10 flex items-center gap-2 text-sm">
            <p className="text-red-500 min-w-0 truncate">Couldn't load your key.</p>
            <button onClick={load} className={smallButton}>Try again</button>
          </div>
        ) : key === null ? (
          // As tall as the row that replaces it, so nothing below jumps
          <div className="h-11 sm:h-10 rounded-lg bg-gray-100 animate-pulse" role="status" aria-label="Loading" />
        ) : key && !replacing ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0 h-11 sm:h-10 flex items-center border border-gray-200 rounded-lg px-3 bg-gray-50 text-sm text-gray-400 tracking-widest select-none">••••••••••••{key.slice(-4)}</div>
            <button onClick={() => { setReplacing(true); setInput('') }} className={smallButton}>Replace</button>
            <button onClick={remove} className={dangerSmall}>Delete</button>
          </div>
        ) : (
          <form onSubmit={save} className="flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Paste API key…"
              aria-label="Gemini API key"
              // A key is case-sensitive: iOS would capitalize its first letter
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              className={rowInput}
            />
            <button type="submit" disabled={!input.trim() || saving} className={primarySmall}>
              <StableLabel current={saving ? 'Saving…' : 'Save'} labels={['Save', 'Saving…']} />
            </button>
            {replacing && <button type="button" onClick={() => setReplacing(false)} className={smallButton}>Cancel</button>}
          </form>
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
            <p className="text-xs text-gray-400 mt-0.5">When off, only receipts you're on are shown in the Receipts tab</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={defaultShowAll}
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
  const goBack = useGoBack()
  return (
    <div className="max-w-xl mx-auto p-4 py-8">
      {/* Only reachable from the account menu: no tab leads back */}
      <BackButton onClick={() => goBack('/')} className="mb-2" />
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>
      <div className="space-y-6">
        <YourName />
        <Account />
        <GeminiKey />
        <Preferences />
      </div>
    </div>
  )
}
