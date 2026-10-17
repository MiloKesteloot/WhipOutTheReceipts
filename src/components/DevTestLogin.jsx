import { supabase } from '../lib/supabase.js'

// Local-development shortcut: one-click sign-in as seeded test accounts.
// Only rendered when import.meta.env.DEV (npm run dev), so production builds
// drop it. Accounts are created by supabase/seed-test-users.sql.
export const TEST_PASSWORD = 'test1234'
const ACCOUNTS = [
  { email: 'milo@test.local', label: 'Milo', note: 'owner, your real history' },
  { email: 'alex@test.local', label: 'Alex', note: 'roommate view' },
  { email: 'newbie@test.local', label: 'New user', note: 'no group yet' },
]

export default function DevTestLogin() {
  async function signInAs(email) {
    await supabase.auth.signOut()
    const { error } = await supabase.auth.signInWithPassword({ email, password: TEST_PASSWORD })
    if (!error) return
    if (/fetch|network/i.test(error.message)) {
      alert("Can't reach the local Supabase server. Start it with: npx supabase@2.121.0 start (Docker Desktop must be running).")
    } else if (/invalid login/i.test(error.message)) {
      alert('Test accounts not set up yet. Run: bash scripts/local-db-reset.sh (this resets local data and seeds the test accounts).')
    } else {
      alert(error.message)
    }
  }

  return (
    <div className="mt-4 border border-dashed border-amber-300 bg-amber-50 rounded-xl p-3">
      <p className="text-xs font-semibold text-amber-700 mb-2">Test accounts (local dev only)</p>
      <div className="space-y-1.5">
        {ACCOUNTS.map(a => (
          <button
            key={a.email}
            onClick={() => signInAs(a.email)}
            className="w-full flex items-center justify-between px-3 py-1.5 bg-white border border-amber-200 rounded-lg text-sm hover:bg-amber-100 transition"
          >
            <span className="font-medium text-gray-800">{a.label}</span>
            <span className="text-xs text-gray-400">{a.note}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
