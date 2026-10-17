import { Link, useLocation } from 'react-router-dom'
import LiquidGlass from 'liquid-glass-react'

// Fake iPhone 16 Pro status bar for screenshot mode: 9:41, Dynamic Island,
// signal / Wi-Fi / battery. Sits in the 54px --safe-top inset above TopNav.
export function IphoneStatusBar() {
  return (
    <div className="ios-font fixed top-0 left-0 right-0 h-[54px] z-[60] pointer-events-none select-none text-black">
      <span className="absolute left-0 w-[33%] top-[17px] text-center text-[17px] font-semibold tracking-tight">9:41</span>
      <div className="absolute left-1/2 -translate-x-1/2 top-[11px] w-[126px] h-[37px] rounded-full bg-black" />
      <div className="absolute right-0 w-[33%] top-[20px] flex items-center justify-center gap-[6px]">
        {/* Cellular */}
        <svg width="19" height="12" viewBox="0 0 19 12" fill="currentColor">
          <rect x="0" y="7.5" width="3.2" height="4.5" rx="1" />
          <rect x="5.1" y="5" width="3.2" height="7" rx="1" />
          <rect x="10.2" y="2.5" width="3.2" height="9.5" rx="1" />
          <rect x="15.3" y="0" width="3.2" height="12" rx="1" />
        </svg>
        {/* Wi-Fi */}
        <svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor">
          <path d="M8.5 2.6c2.3 0 4.4.9 6 2.4l1.2-1.2A10 10 0 0 0 8.5.9 10 10 0 0 0 1.3 3.8L2.5 5a8.4 8.4 0 0 1 6-2.4Z" />
          <path d="M8.5 6.1c1.3 0 2.5.5 3.5 1.4l1.2-1.2a6.6 6.6 0 0 0-9.4 0L5 7.5c1-.9 2.2-1.4 3.5-1.4Z" />
          <path d="M8.5 9.4c.5 0 1 .2 1.3.5L8.5 11.3 7.2 9.9c.3-.3.8-.5 1.3-.5Z" />
        </svg>
        {/* Battery */}
        <svg width="27" height="13" viewBox="0 0 27 13" fill="none">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.8" stroke="currentColor" strokeOpacity="0.35" />
          <rect x="2" y="2" width="20" height="9" rx="2.5" fill="currentColor" />
          <path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" fill="currentColor" fillOpacity="0.4" />
        </svg>
      </div>
    </div>
  )
}

// LiquidGlass places each piece by its center (top/left + translate -50%),
// so these are center points. Bar is 62px tall, 25px above the screen bottom,
// with 20px side margins and a 12px gap before the 62px "+" button.
const BAR_CENTER_TOP = 'calc(100% - 25px - 31px)'
const glassProps = {
  displacementScale: 64,
  blurAmount: 0.1,
  saturation: 160,
  aberrationIntensity: 2,
  elasticity: 0, // no wobble toward the cursor while screenshotting
  cornerRadius: 999,
  padding: '0',
}
// The library's content wrapper sets white, shadowed 20px text; reset it
const reset = { textShadow: 'none', fontSize: 'initial' }

// iOS 26-style floating Liquid Glass tab bar (liquid-glass-react, which does
// real refraction in Chromium): a capsule of tabs with the selected one on a
// lighter pill, plus a separate round "+" button
export function GlassTabBar({ tabs, TabIcon, PlusIcon }) {
  const { pathname } = useLocation()

  return (
    <nav className="ios-font sm:hidden fixed inset-0 z-40 pointer-events-none select-none">
      <LiquidGlass
        {...glassProps}
        style={{ position: 'fixed', top: BAR_CENTER_TOP, left: 'calc(50vw - 37px)', pointerEvents: 'auto' }}
      >
        <div className="ios-font h-[62px] p-1 grid grid-cols-4" style={{ ...reset, width: 'calc(100vw - 114px)' }}>
          {tabs.map(t => {
            const active = t.match(pathname)
            return (
              <Link
                key={t.to}
                to={t.to}
                className={`flex flex-col items-center justify-center gap-0.5 rounded-full text-[10px] leading-tight font-semibold transition-colors ${active ? 'bg-black/[0.06] text-accent-600' : 'text-gray-800'}`}
              >
                <TabIcon d={t.icon} active={active} className="w-6 h-6" />
                {t.label}
              </Link>
            )
          })}
        </div>
      </LiquidGlass>
      <LiquidGlass
        {...glassProps}
        style={{ position: 'fixed', top: BAR_CENTER_TOP, left: 'calc(100vw - 51px)', pointerEvents: 'auto' }}
      >
        <Link
          to="/receipt/new"
          aria-label="New receipt"
          className="w-[62px] h-[62px] rounded-full flex items-center justify-center text-accent-600"
          style={reset}
        >
          <PlusIcon className="w-7 h-7" />
        </Link>
      </LiquidGlass>
    </nav>
  )
}
