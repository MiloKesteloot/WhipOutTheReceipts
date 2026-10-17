import { Link, useLocation } from 'react-router-dom'
import LiquidGlass from 'liquid-glass-react'

const glassProps = {
  displacementScale: 64,
  blurAmount: 0.1,
  saturation: 160,
  aberrationIntensity: 2,
  elasticity: 0, // no wobble toward the cursor
  cornerRadius: 999,
  padding: '0',
}
// The library's content wrapper sets white, shadowed 20px text; reset it
const reset = { textShadow: 'none', fontSize: 'initial' }

// Phone-only iOS 26-style floating Liquid Glass tab bar (liquid-glass-react;
// refraction shows in Chromium, Safari gets the blur): a capsule of tabs with
// the selected one on a lighter pill, plus a separate round "+" button.
// LiquidGlass places each piece by its center (top/left + translate -50%),
// so the lefts are center points within the 62px-tall bottom strip: 20px side
// margins and a 12px gap before the 62px "+" button.
export default function GlassTabBar({ tabs, TabIcon, PlusIcon }) {
  const { pathname } = useLocation()

  return (
    <nav
      className="sm:hidden fixed left-0 right-0 z-40 h-[62px] pointer-events-none select-none"
      style={{ bottom: 'max(12px, calc(var(--safe-bottom) - 9px))' }}
    >
      <LiquidGlass
        {...glassProps}
        style={{ position: 'absolute', top: '50%', left: 'calc(50% - 37px)', pointerEvents: 'auto' }}
      >
        <div className="h-[62px] p-1 grid grid-cols-4" style={{ ...reset, width: 'calc(100vw - 114px)' }}>
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
        style={{ position: 'absolute', top: '50%', left: 'calc(100% - 51px)', pointerEvents: 'auto' }}
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
