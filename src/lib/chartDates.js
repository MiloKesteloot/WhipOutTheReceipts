// Dates along a chart's time axis. Receipt dates are calendar days
// ("2026-03-10"), so they're placed and printed in UTC: no time zone can shift
// them a day.

const DAY = 24 * 60 * 60 * 1000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "2026-03-10" → a number to plot
export function dayValue(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

// About `count` evenly spaced whole days from the first to the last
export function dateTicks(first, last, count = 4) {
  if (!(last > first)) return [first]
  const step = (last - first) / (count - 1)
  const ticks = Array.from({ length: count }, (_, i) => Math.round((first + step * i) / DAY) * DAY)
  return [...new Set(ticks)]
}

// "Mar 10", or "Mar '26" when the chart spans most of a year or more
export function formatTick(value, span) {
  const d = new Date(value)
  const month = MONTHS[d.getUTCMonth()]
  return span > 300 * DAY ? `${month} '${String(d.getUTCFullYear()).slice(2)}` : `${month} ${d.getUTCDate()}`
}

// "Mar 10, 2026" for tooltips
export function formatDay(value) {
  const d = new Date(value)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}
