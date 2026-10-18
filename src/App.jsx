import { useState, useEffect, useRef } from 'react'
import { Routes, Route, Link, Navigate, ScrollRestoration, useLocation, useNavigate } from 'react-router-dom'
import Home from './pages/Home.jsx'
import ReceiptDetail from './pages/ReceiptDetail.jsx'
import AddReceipt from './pages/AddReceipt.jsx'
import Auth, { SetNewPassword, CompleteProfile } from './pages/Auth.jsx'
import Landing from './pages/Landing.jsx'
import Guest from './pages/Guest.jsx'
import Onboarding, { Join } from './pages/Onboarding.jsx'
import Stats from './pages/Stats.jsx'
import Settings from './pages/Settings.jsx'
import GroupSettings from './pages/GroupSettings.jsx'
import Receipts from './pages/Receipts.jsx'
import Balances from './pages/Balances.jsx'
import { SessionProvider, useSession } from './lib/session.jsx'
import { GroupProvider, useGroup } from './lib/group.jsx'
import GlassTabBar from './components/GlassTabBar.jsx'
import { LOGO_URL } from './lib/logo.js'
import { useDialog } from './lib/useDialog.jsx'
import { hasUnsavedChanges, leaveWithoutPrompt } from './lib/unsaved.jsx'

// Main sections. Receipt pages count as "Receipts"; the add form has no tab.
const TABS = [
  {
    to: '/', label: 'Home', match: p => p === '/',
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  },
  {
    to: '/receipts', label: 'Receipts',
    match: p => p === '/receipts' || (p.startsWith('/receipt/') && p !== '/receipt/new' && !p.endsWith('/edit')),
    icon: 'M9 7h6m-6 4h6m-6 4h3M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z',
  },
  {
    to: '/balances', label: 'Balances', match: p => p === '/balances',
    icon: 'M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4',
  },
  {
    to: '/stats', label: 'Stats', match: p => p === '/stats',
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  },
]

function TabIcon({ d, active, className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={active ? 2.5 : 2}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  )
}

function PlusIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
    </svg>
  )
}

// Top bar. Phones: app name + account menu (sections are in the bottom tab
// bar). Desktop: section links, "New receipt" and the account menu.
function TopNav() {
  const { pathname } = useLocation()
  useEffect(() => { window.getSelection()?.removeAllRanges() }, [pathname])

  return (
    <nav className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-50 select-none" style={{ paddingTop: 'var(--safe-top)' }}>
      <div className="max-w-5xl mx-auto flex items-center px-4 h-14">
        <Link to="/" aria-label="Receipts home" className="mr-4 shrink-0">
          <img src={LOGO_URL} alt="" width={32} height={32} className="w-8 h-8" />
        </Link>
        <div className="hidden sm:flex items-center">
          {TABS.map(tab => {
            const active = tab.match(pathname)
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={`flex items-center gap-1.5 px-3 py-1.5 shrink-0 rounded-md text-sm font-medium transition-colors ${active ? 'text-accent-600' : 'text-gray-400 hover:text-gray-600'}`}
              >
                <TabIcon d={tab.icon} active={active} className="w-4 h-4" />
                {tab.label}
              </Link>
            )
          })}
        </div>
        <div className="ml-auto flex flex-1 justify-end items-center gap-2 min-w-0">
          <Link
            to="/receipt/new"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-600 text-white text-sm font-semibold hover:bg-accent-700 transition shrink-0"
          >
            <PlusIcon className="w-4 h-4" />
            New receipt
          </Link>
          <UserMenu />
        </div>
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
  const { confirm, DialogUI } = useDialog()

  // Switching reloads every page, so unsaved work would be lost: ask first.
  // Home replaces the current page, so Back doesn't reopen the old group's.
  async function pickGroup(id) {
    setOpen(false)
    if (id === group?.id) return
    if (hasUnsavedChanges() && !await confirm('Your unsaved changes will be lost.', {
      title: 'Switch group?', confirmLabel: 'Switch', cancelLabel: 'Stay', danger: true,
    })) return
    leaveWithoutPrompt()
    switchGroup(id)
    navigate('/', { replace: true })
  }

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
    <div className="relative min-w-0" ref={ref}>
      {DialogUI}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Account menu"
        className="flex items-center gap-2 max-w-full pl-2 pr-0 sm:px-3 py-1.5 rounded-md text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
      >
        {/* Phones: current group next to the circle */}
        <span className="sm:hidden text-gray-600 truncate min-w-0">{group?.name}</span>
        <span className="w-7 h-7 shrink-0 rounded-full bg-accent-100 text-accent-700 flex items-center justify-center text-xs font-bold">
          {(myName || '?').slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden sm:flex flex-col items-start leading-tight min-w-0">
          <span className="text-gray-800 max-w-full truncate">{myName}</span>
          <span className="text-[11px] text-gray-400 max-w-full truncate">{group?.name}</span>
        </span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50">
          <p className="px-4 pt-2 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">Groups</p>
          {memberships.map(m => (
            <button
              key={m.group_id}
              onClick={() => pickGroup(m.group_id)}
              className="w-full flex items-center justify-between px-4 py-2 text-sm text-left hover:bg-gray-50"
            >
              <span className={`truncate ${m.group_id === group?.id ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{m.groups.name}</span>
              {m.group_id === group?.id && <span className="text-accent-600 shrink-0 ml-2">✓</span>}
            </button>
          ))}
          <Link to="/group" className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Group settings &amp; invite</Link>
          <Link to="/groups/new" className="block px-4 py-2 text-sm text-accent-600 hover:bg-gray-50">+ Create or join a group</Link>
          <div className="border-t border-gray-100 my-1" />
          <p className="px-4 pt-2 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">Account</p>
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
      // Already showing it (signed in on the invite link): don't add it again
      if (pathname !== `/join/${code}`) navigate(`/join/${code}`, { replace: true })
    }
  }, [])

  if (pathname.startsWith('/join/')) {
    return <Routes><Route path="/join/:code" element={<Join />} /></Routes>
  }
  if (loading) return <FullPageLoading />
  if (memberships.length === 0 || pathname === '/groups/new') return <Onboarding />

  // The add/edit form hides the tab bar so a stray tap can't drop a draft
  const showTabs = pathname !== '/receipt/new' && !pathname.endsWith('/edit')

  return (
    <div className={`min-h-screen bg-gray-50 pt-topnav sm:pb-12 ${showTabs ? 'pb-tabbar' : 'pb-12'}`}>
      <TopNav />
      {/* Keyed by group so every page reloads its data when switching groups */}
      <Routes key={group?.id}>
        <Route path="/" element={<Home />} />
        <Route path="/receipts" element={<Receipts />} />
        <Route path="/receipt/new" element={<AddReceipt />} />
        <Route path="/receipt/:receiptId" element={<ReceiptDetail />} />
        <Route path="/receipt/:receiptId/edit" element={<AddReceipt />} />
        <Route path="/balances" element={<Balances />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/group" element={<GroupSettings />} />
        {/* Old routes */}
        <Route path="/search" element={<Redirect to="/receipts" />} />
        <Route path="/payments" element={<Redirect to="/balances" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {showTabs && <GlassTabBar tabs={TABS} TabIcon={TabIcon} PlusIcon={PlusIcon} />}
    </div>
  )
}

// Redirect that keeps the query string (e.g. /search?q=milk → /receipts?q=milk)
function Redirect({ to }) {
  const { search } = useLocation()
  return <Navigate to={to + search} replace />
}

function Gate() {
  const { session, loading, profile, refreshProfile, recovering, finishRecovery } = useSession()
  const { pathname } = useLocation()

  // Guest links work for anyone with the link, signed in or not
  if (pathname.startsWith('/guest/')) {
    return <Routes><Route path="/guest/:token" element={<Guest />} /></Routes>
  }
  if (loading) return <FullPageLoading />
  if (recovering) return <SetNewPassword onDone={finishRecovery} />
  if (!session) {
    const invite = pathname.match(/^\/join\/([A-Za-z0-9]+)/)
    if (invite) localStorage.setItem(PENDING_INVITE, invite[1])
    // Signed-out home is the landing page; any other link asks to sign in
    if (pathname === '/') return <Landing />
    return <Auth key={pathname} initialMode={pathname === '/signup' ? 'signup' : 'signin'} />
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
      {/* New pages start at the top; Back returns to where you were */}
      <ScrollRestoration />
      <Gate />
    </SessionProvider>
  )
}
