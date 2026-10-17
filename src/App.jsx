import { useState, useEffect, useRef } from 'react'
import { Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import Home from './pages/Home.jsx'
import ReceiptDetail from './pages/ReceiptDetail.jsx'
import AddReceipt from './pages/AddReceipt.jsx'
import Auth, { SetNewPassword, CompleteProfile } from './pages/Auth.jsx'
import Onboarding, { Join } from './pages/Onboarding.jsx'
import Stats from './pages/Stats.jsx'
import Settings from './pages/Settings.jsx'
import GroupSettings from './pages/GroupSettings.jsx'
import Payments from './pages/Payments.jsx'
import Search from './pages/Search.jsx'
import { NavSearch } from './lib/search.jsx'
import { SessionProvider, useSession } from './lib/session.jsx'
import { GroupProvider, useGroup } from './lib/group.jsx'

function TopNav() {
  const { pathname } = useLocation()
  const active = path => pathname === path
  useEffect(() => { window.getSelection()?.removeAllRanges() }, [pathname])

  return (
    <nav className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-50 select-none">
      <div className="max-w-5xl mx-auto flex items-center px-2 sm:px-4 h-14">
        {/* ml-2 on phones lines the logo up with page content (px-4) while the nav keeps px-2 for the icons */}
        <Link to="/" className="font-bold text-gray-900 text-base ml-2 sm:ml-0 mr-2 sm:mr-4 shrink-0">
          Receipts
        </Link>
        <Link
          to="/"
          aria-label="Home"
          className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 shrink-0 rounded-md text-sm font-medium transition-colors ${active('/') ? 'text-accent-600' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active('/') ? 2.5 : 2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          <span className="hidden sm:inline">Home</span>
        </Link>

        <NavSearch />

        <Link
          to="/stats"
          aria-label="Stats"
          className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 shrink-0 rounded-md text-sm font-medium transition-colors ${active('/stats') ? 'text-accent-600' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active('/stats') ? 2.5 : 2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <span className="hidden sm:inline">Stats</span>
        </Link>

        <Link
          to="/payments"
          aria-label="Payments"
          className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 shrink-0 rounded-md text-sm font-medium transition-colors ${active('/payments') ? 'text-accent-600' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active('/payments') ? 2.5 : 2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
          </svg>
          <span className="hidden sm:inline">Payments</span>
        </Link>

        <Link
          to="/settings"
          aria-label="Settings"
          className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 shrink-0 rounded-md text-sm font-medium transition-colors ${active('/settings') ? 'text-accent-600' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active('/settings') ? 2.5 : 2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="hidden sm:inline">Settings</span>
        </Link>

        <UserMenu />
      </div>
    </nav>
  )
}

// Account + group menu: switch groups, add a group, settings, sign out
function UserMenu() {
  const { signOut } = useSession()
  const { memberships, group, switchGroup, myName } = useGroup()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const navigate = useNavigate()
  const { pathname } = useLocation()

  useEffect(() => { setOpen(false) }, [pathname])
  useEffect(() => {
    if (!open) return
    const onClick = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onClick); window.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div className="relative ml-auto shrink-0" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Account menu"
        className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
      >
        <span className="w-7 h-7 rounded-full bg-accent-100 text-accent-700 flex items-center justify-center text-xs font-bold">
          {(myName || '?').slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden sm:flex flex-col items-start leading-tight">
          <span className="text-gray-800">{myName}</span>
          <span className="text-[11px] text-gray-400 max-w-[140px] truncate">{group?.name}</span>
        </span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50">
          <p className="px-4 pt-2 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">Groups</p>
          {memberships.map(m => (
            <button
              key={m.group_id}
              onClick={() => { switchGroup(m.group_id); setOpen(false); navigate('/') }}
              className="w-full flex items-center justify-between px-4 py-2 text-sm text-left hover:bg-gray-50"
            >
              <span className={`truncate ${m.group_id === group?.id ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{m.groups.name}</span>
              {m.group_id === group?.id && <span className="text-accent-600 shrink-0 ml-2">✓</span>}
            </button>
          ))}
          <Link to="/group" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Group settings &amp; invite</Link>
          <Link to="/groups/new" className="block px-4 py-2 text-sm text-accent-600 hover:bg-gray-50">+ Create or join a group</Link>
          <div className="border-t border-gray-100 my-1" />
          <Link to="/settings" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Your settings</Link>
          <button onClick={signOut} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Sign out</button>
        </div>
      )}
    </div>
  )
}

function FullPageLoading() {
  return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-400">Loading…</div>
}

// Invite links opened while signed out are remembered until after sign-in
// (localStorage, so it survives the email-confirmation tab).
const PENDING_INVITE = 'pending-invite'

function SignedInApp() {
  const { loading, memberships, group } = useGroup()
  const { user } = useSession()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const code = localStorage.getItem(PENDING_INVITE) || user.user_metadata?.pending_invite
    if (code) {
      localStorage.removeItem(PENDING_INVITE)
      navigate(`/join/${code}`)
    }
  }, [])

  if (pathname.startsWith('/join/')) {
    return <Routes><Route path="/join/:code" element={<Join />} /></Routes>
  }
  if (loading) return <FullPageLoading />
  if (memberships.length === 0 || pathname === '/groups/new') return <Onboarding />

  return (
    <div className="min-h-screen bg-gray-50 pt-14 pb-24">
      <TopNav />
      {/* Keyed by group so every page reloads its data when switching groups */}
      <Routes key={group?.id}>
        <Route path="/" element={<Home />} />
        <Route path="/receipt/new" element={<AddReceipt />} />
        <Route path="/receipt/:receiptId" element={<ReceiptDetail />} />
        <Route path="/receipt/:receiptId/edit" element={<AddReceipt />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/group" element={<GroupSettings />} />
        <Route path="/search" element={<Search />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <NewReceiptButton />
    </div>
  )
}

// Floating "+" for the app's main action. Hidden on receipt pages, which
// have their own bottom bar (save claims) or are the add form itself.
function NewReceiptButton() {
  const { pathname } = useLocation()
  if (pathname.startsWith('/receipt/')) return null
  return (
    <Link
      to="/receipt/new"
      aria-label="New receipt"
      title="New receipt"
      className="fixed bottom-5 right-5 z-40 flex items-center gap-2 h-14 pl-4 pr-5 rounded-full bg-accent-600 text-white font-semibold shadow-lg hover:bg-accent-700 transition"
    >
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
      </svg>
      <span>New receipt</span>
    </Link>
  )
}

function Gate() {
  const { session, loading, profile, refreshProfile, recovering, finishRecovery } = useSession()
  const { pathname } = useLocation()

  if (loading) return <FullPageLoading />
  if (recovering) return <SetNewPassword onDone={finishRecovery} />
  if (!session) {
    const invite = pathname.match(/^\/join\/([A-Za-z0-9]+)/)
    if (invite) localStorage.setItem(PENDING_INVITE, invite[1])
    return <Auth />
  }
  if (!profile?.first_name?.trim()) return <CompleteProfile profile={profile} onDone={refreshProfile} />
  return (
    <GroupProvider>
      <SignedInApp />
    </GroupProvider>
  )
}

export default function App() {
  return (
    <SessionProvider>
      <Gate />
    </SessionProvider>
  )
}
