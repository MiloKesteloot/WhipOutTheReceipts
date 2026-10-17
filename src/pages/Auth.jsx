import { useEffect, useRef, useState } from 'react'
import { supabase, appBaseUrl } from '../lib/supabase.js'
import { APP_NAME, APP_TAGLINE } from '../config.js'
import { useSession } from '../lib/session.jsx'
import { version as buildVersion } from '../buildVersion.json'

const inputClass = 'w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-accent-400 text-gray-900'
const primaryButton = 'w-full py-3 bg-accent-600 text-white font-semibold rounded-xl hover:bg-accent-700 transition disabled:opacity-50'

export function AuthShell({ title, subtitle, children }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{APP_NAME}</h1>
          <p className="text-gray-500">{APP_TAGLINE}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          {title && <h2 className="text-lg font-semibold text-gray-800 mb-1">{title}</h2>}
          {subtitle && <p className="text-sm text-gray-400 mb-4">{subtitle}</p>}
          {children}
        </div>
        <p className="mt-6 text-center text-xs text-gray-300">v{buildVersion}</p>
      </div>
    </div>
  )
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

// Google's sign-in script, loaded once. Rejects if blocked (privacy
// extensions, Brave) or slow, so the caller can fall back.
let googleScript
function loadGoogleScript() {
  googleScript ||= new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = 'https://accounts.google.com/gsi/client'
    el.async = true
    el.onload = () => (window.google?.accounts?.id ? resolve(window.google) : reject(new Error('GIS unavailable')))
    el.onerror = () => reject(new Error('GIS blocked'))
    document.head.appendChild(el)
    setTimeout(() => reject(new Error('GIS timeout')), 6000)
  })
  return googleScript
}

// Google gets the SHA-256 of the nonce; Supabase gets the raw value and checks they match
async function makeNonce() {
  const raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  const hashed = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  return { raw, hashed }
}

// Google's own button (and One Tap) signs in without redirecting through the
// Supabase domain, so Google's prompt names this site instead. Falls back to
// the redirect flow if the script can't load.
function GoogleButton() {
  const containerRef = useRef(null)
  const [state, setState] = useState(GOOGLE_CLIENT_ID ? 'loading' : 'fallback') // loading | google | fallback
  const [error, setError] = useState('')

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return
    let cancelled = false
    ;(async () => {
      try {
        const google = await loadGoogleScript()
        const nonce = await makeNonce()
        if (cancelled) return
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          nonce: nonce.hashed,
          use_fedcm_for_prompt: true,
          callback: async ({ credential }) => {
            setError('')
            const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: credential, nonce: nonce.raw })
            if (error) setError(error.message)
          },
        })
        google.accounts.id.renderButton(containerRef.current, {
          theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular',
          width: Math.min(400, containerRef.current.offsetWidth),
        })
        google.accounts.id.prompt()
        setState('google')
      } catch {
        if (!cancelled) setState('fallback')
      }
    })()
    return () => { cancelled = true; window.google?.accounts?.id?.cancel() }
  }, [])

  async function redirectSignIn() {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appBaseUrl } })
    if (error) setError(error.message)
  }

  return (
    <>
      {state !== 'fallback' && (
        <div ref={containerRef} className="w-full min-h-[44px] flex justify-center" />
      )}
      {state === 'fallback' && (
        <button
          type="button"
          onClick={redirectSignIn}
          className="w-full py-3 border border-gray-300 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          Continue with Google
        </button>
      )}
      {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
    </>
  )
}

export default function Auth() {
  const [mode, setMode] = useState('signin') // signin | signup | forgot
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const { linkError } = useSession()
  const [error, setError] = useState(linkError)
  const [notice, setNotice] = useState('')

  function switchMode(m) { setMode(m); setError(''); setNotice('') }

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(''); setNotice('')
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) setError(error.message === 'Email not confirmed'
        ? 'Please confirm your email first — check your inbox for the link.'
        : error.message)
    } else if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          // Remembered on the account so an invite survives confirming on another device
          data: { first_name: firstName.trim(), last_name: lastName.trim(), pending_invite: localStorage.getItem('pending-invite') },
          emailRedirectTo: appBaseUrl,
        },
      })
      if (error) setError(error.message)
      else if (!data.session) setNotice(`Almost done! We sent a confirmation link to ${email.trim()}.`)
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appBaseUrl })
      if (error) setError(error.message)
      else setNotice(`If an account exists for ${email.trim()}, a reset link is on its way.`)
    }
    setBusy(false)
  }

  const titles = {
    signin: ['Sign in', 'Welcome back.'],
    signup: ['Create an account', 'Split receipts with your roommates.'],
    forgot: ['Reset your password', "Enter your email and we'll send you a link."],
  }

  return (
    <AuthShell title={titles[mode][0]} subtitle={titles[mode][1]}>
      {mode !== 'forgot' && (
        <>
          <GoogleButton />
          <div className="flex items-center gap-3 my-4 text-xs text-gray-400">
            <div className="flex-1 border-t border-gray-200" />or<div className="flex-1 border-t border-gray-200" />
          </div>
        </>
      )}

      <form onSubmit={submit} className="space-y-3">
        {mode === 'signup' && (
          <div className="flex gap-2">
            <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First name" required autoComplete="given-name" className={inputClass} />
            <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last name" required autoComplete="family-name" className={inputClass} />
          </div>
        )}
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" required autoComplete="email" className={inputClass} />
        {mode !== 'forgot' && (
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            required
            minLength={6}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            className={inputClass}
          />
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        {notice && <p className="text-sm text-accent-700 bg-accent-50 rounded-lg px-3 py-2">{notice}</p>}
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy ? '…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
        </button>
      </form>

      <div className="mt-4 text-sm text-center space-y-1.5">
        {mode === 'signin' && (
          <>
            <button onClick={() => switchMode('forgot')} className="text-gray-400 hover:text-gray-600">Forgot password?</button>
            <p className="text-gray-500">New here? <button onClick={() => switchMode('signup')} className="text-accent-600 font-medium hover:text-accent-700">Create an account</button></p>
          </>
        )}
        {mode !== 'signin' && (
          <p className="text-gray-500">Already have an account? <button onClick={() => switchMode('signin')} className="text-accent-600 font-medium hover:text-accent-700">Sign in</button></p>
        )}
      </div>
    </AuthShell>
  )
}

// Shown after following a password-reset link
export function SetNewPassword({ onDone }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) setError(error.message)
    else onDone()
  }

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={submit} className="space-y-3">
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="New password"
          required minLength={6} autoComplete="new-password" autoFocus className={inputClass} />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button type="submit" disabled={busy} className={primaryButton}>{busy ? '…' : 'Save password'}</button>
      </form>
    </AuthShell>
  )
}

// Google accounts without a name (or old profiles) fill this in once
export function CompleteProfile({ profile, onDone }) {
  const [firstName, setFirstName] = useState(profile?.first_name || '')
  const [lastName, setLastName] = useState(profile?.last_name || '')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    await supabase.from('profiles').update({ first_name: firstName.trim(), last_name: lastName.trim() }).eq('id', profile.id)
    setBusy(false)
    onDone()
  }

  return (
    <AuthShell title="What's your name?" subtitle="Your roommates will see your first name.">
      <form onSubmit={submit} className="space-y-3">
        <div className="flex gap-2">
          <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First name" required autoFocus className={inputClass} />
          <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last name" required className={inputClass} />
        </div>
        <button type="submit" disabled={busy || !firstName.trim()} className={primaryButton}>{busy ? '…' : 'Continue'}</button>
      </form>
    </AuthShell>
  )
}

export { inputClass, primaryButton }
