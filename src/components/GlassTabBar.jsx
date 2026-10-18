import { Link, useLocation } from 'react-router-dom'

// Phone-only iOS 26-style floating glass tab bar: a capsule of tabs with the
// selected one on a lighter pill, plus a separate round "+" button
export default function GlassTabBar({ tabs, TabIcon, PlusIcon }) {
  const { pathname } = useLocation()

  return (
    <nav
      className="sm:hidden fixed left-0 right-0 z-40 px-5 flex items-center gap-3 select-none"
      style={{ bottom: 'max(12px, calc(var(--safe-bottom) - 9px))' }}
    >
      <div className="liquid-glass flex-1 h-[62px] rounded-full p-1 grid grid-cols-4">
        {tabs.map(t => {
          const active = t.match(pathname)
          return (
            <Link
              key={t.to}
              to={t.to}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-full text-[10px] font-semibold transition-colors ${active ? 'bg-black/[0.06] text-accent-600' : 'text-gray-800'}`}
            >
              <TabIcon d={t.icon} active={active} className="w-6 h-6" />
              {t.label}
            </Link>
          )
        })}
      </div>
      <Link
        to="/receipt/new"
        aria-label="New receipt"
        className="liquid-glass w-[62px] h-[62px] shrink-0 rounded-full flex items-center justify-center text-accent-600 active:scale-95 transition"
      >
        <PlusIcon className="w-7 h-7" />
      </Link>
    </nav>
  )
}
