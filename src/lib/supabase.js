import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// PKCE puts the auth code in the query string (?code=...), which doesn't
// collide with HashRouter's #/routes the way the implicit flow's #tokens do.
export const supabase = createClient(url, key, {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true },
})

// The app's own URL (works on localhost and GitHub Pages)
export const appBaseUrl = `${window.location.origin}${import.meta.env.BASE_URL}`
