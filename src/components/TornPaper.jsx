import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// A white box with torn-receipt zigzag top and bottom edges (see .tear-paper
// in index.css). This many teeth span the box:
const TEAR_COUNT_PHONE = 16
const TEAR_COUNT_DESKTOP = 27
const DESKTOP_QUERY = '(min-width: 640px)' // Tailwind's sm breakpoint

// Mask tiles for one tooth w wide and h tall. Each tile has its peaks at the
// sides, so the edge rises up the side of the box and then slopes down. It
// runs 1px past the dips so it overlaps the solid middle (no hairline seam at
// fractional zooms).
function tearTile(w, h, bottom) {
  const d = bottom
    ? `M0 ${h + 1}L${w / 2} 1L${w} ${h + 1}V0H0z`
    : `M0 0L${w / 2} ${h}L${w} 0V${h + 1}H0z`
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

  // Measured before the first paint, so the teeth (and the rows padded by
  // them) don't jump once the real width is known. The guess is the page
  // width minus its padding, capped at the max-w-xl content width.
  const [width, setWidth] = useState(() => Math.min(window.innerWidth - 32, 544))
  const paperRef = useRef(null)
  useLayoutEffect(() => {
    const el = paperRef.current
    setWidth(el.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => setWidth(entry.borderBoxSize[0].inlineSize))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const w = width / (isDesktop ? TEAR_COUNT_DESKTOP : TEAR_COUNT_PHONE)
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
