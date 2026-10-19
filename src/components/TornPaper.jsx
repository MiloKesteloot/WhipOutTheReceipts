import { useCallback, useEffect, useRef, useState } from 'react'

// A white box with torn-receipt zigzag top and bottom edges (see .tear-paper
// in index.css). This many teeth span the box:
const TEAR_COUNT_PHONE = 16
const TEAR_COUNT_DESKTOP = 27
const DESKTOP_QUERY = '(min-width: 640px)' // Tailwind's sm breakpoint

// Mask tiles for one tooth w wide and h tall, each running 1px past the dips
// so it overlaps the solid middle (no hairline seam at fractional zooms)
function tearTile(w, h, bottom) {
  const d = bottom
    ? `M0 1L${w / 2} ${h + 1}L${w} 1V0H0z`
    : `M0 ${h}L${w / 2} 0L${w} ${h}V${h + 1}H0z`
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h + 1}' preserveAspectRatio='none'><path d='${d}'/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

// The page lays out its rows to reach into the teeth (padding by --tear-h),
// so their backgrounds and hover colors fill the torn edges too.
export default function TornPaper({ className = '', children }) {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY)
    const onChange = () => setIsDesktop(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const [width, setWidth] = useState(0)
  const observer = useRef(null)
  const paperRef = useCallback(el => {
    observer.current?.disconnect()
    if (!el) return
    observer.current = new ResizeObserver(([entry]) => setWidth(entry.borderBoxSize[0].inlineSize))
    observer.current.observe(el)
  }, [])

  const w = (width || 544) / (isDesktop ? TEAR_COUNT_DESKTOP : TEAR_COUNT_PHONE)
  const h = w / 2
  return (
    <div className={`tear-wrap ${className}`}>
      <div
        ref={paperRef}
        className="tear-paper bg-white overflow-hidden"
        style={{
          '--tear-w': `${w}px`,
          '--tear-h': `${h}px`,
          '--tear-top': tearTile(w, h, false),
          '--tear-bottom': tearTile(w, h, true),
        }}
      >
        {children}
      </div>
    </div>
  )
}
