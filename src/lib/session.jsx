import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase.js'

const SessionContext = createContext(null)

// Login state + the signed-in user's profile.
// `recovering` is true after clicking a password-reset email link.
export function SessionProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const [profile, setProfile] = useState(null)
  const [recovering, setRecovering] = useState(false)
  const [linkError, setLinkError] = useState('')
  // Email links (confirm signup / reset password) arrive as
  // ?token_hash=...&type=...; verifying here works on any device.
  const [emailLink] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const tokenHash = params.get('token_hash')
    return tokenHash ? { tokenHash, type: params.get('type') } : null
  })
  const [verifying, setVerifying] = useState(!!emailLink)

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      setSession(s)
    })

    if (emailLink) {
      window.history.replaceState(null, '', window.location.pathname + window.location.hash)
      supabase.auth.verifyOtp({ token_hash: emailLink.tokenHash, type: emailLink.type }).then(({ data, error }) => {
        if (error) {
          setLinkError(/expired|invalid/i.test(error.message)
            ? 'That link has expired or was already used. Please try again.'
            : error.message)
        } else {
          if (emailLink.type === 'recovery') setRecovering(true)
          setSession(data.session)
        }
        setVerifying(false)
      })
    } else {
      supabase.auth.getSession().then(({ data }) => setSession(data.session))
    }
    return () => sub.subscription.unsubscribe()
  }, [])

  // Remove ?code=... left in the address bar after an auth redirect
  useEffect(() => {
    if (session && window.location.search) {
      window.history.replaceState(null, '', window.location.pathname + window.location.hash)
    }
  }, [session])

  const userId = session?.user?.id
  const refreshProfile = useCallback(async () => {
    if (!userId) { setProfile(null); return }
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    setProfile(data || { id: userId, first_name: '', last_name: '' })
  }, [userId])

  useEffect(() => { refreshProfile() }, [refreshProfile])

  async function signOut() {
    await supabase.auth.signOut()
    setProfile(null)
  }

  return (
    <SessionContext.Provider value={{
      session,
      user: session?.user || null,
      loading: verifying || session === undefined || (!!userId && profile === null),
      profile,
      refreshProfile,
      recovering,
      finishRecovery: () => setRecovering(false),
      linkError,
      signOut,
    }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  return useContext(SessionContext)
}
