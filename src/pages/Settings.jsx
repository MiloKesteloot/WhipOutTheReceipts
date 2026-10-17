import { useEffect, useState } from 'react'
import { supabase, appBaseUrl } from '../lib/supabase.js'
import { useDialog } from '../lib/useDialog.jsx'
import { useSession } from '../lib/session.jsx'
import { useGroup } from '../lib/group.jsx'
import { useIphoneMock, setIphoneMock } from '../lib/iphoneMock.js'

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
  const iphoneMock = useIphoneMock()
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
        <label className="flex items-center justify-between cursor-pointer border-t border-gray-100 mt-4 pt-4">
          <div>
            <p className="text-sm font-medium text-gray-800">iPhone screenshot mode</p>
            <p className="text-xs text-gray-400 mt-0.5">Fake iOS status bar and Liquid Glass tab bar, for screenshots at phone width</p>
          </div>
          <button
            onClick={() => setIphoneMock(!iphoneMock)}
            className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ml-4 ${iphoneMock ? 'bg-accent-600' : 'bg-gray-200'}`}
          >
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${iphoneMock ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </label>
      </div>
    </section>
  )
}

export default function Settings() {
  return (
    <div className="max-w-xl mx-auto p-4 py-8">
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
