import { describe, it, expect } from 'vitest'
import { dayValue, dateTicks, formatTick, formatDay } from './chartDates.js'

const DAY = 24 * 60 * 60 * 1000

describe('chart dates', () => {
  it('reads a receipt date as that calendar day', () => {
    expect(formatDay(dayValue('2026-03-10'))).toBe('Mar 10, 2026')
    expect(formatDay(dayValue('2026-12-31'))).toBe('Dec 31, 2026')
  })

  it('spreads a few whole-day ticks from the first date to the last', () => {
    const first = dayValue('2026-01-01')
    const last = dayValue('2026-01-31')
    const ticks = dateTicks(first, last, 4)
    expect(ticks).toHaveLength(4)
    expect(ticks[0]).toBe(first)
    expect(ticks[3]).toBe(last)
    for (const t of ticks) expect(t % DAY).toBe(0)
    expect(ticks.map(t => formatTick(t, last - first))).toEqual(['Jan 1', 'Jan 11', 'Jan 21', 'Jan 31'])
  })

  it('never repeats a tick on a short span', () => {
    const first = dayValue('2026-05-01')
    expect(dateTicks(first, first + DAY, 4)).toEqual([first, first + DAY])
    expect(dateTicks(first, first, 4)).toEqual([first])
  })

  it('shows month and year across a long span', () => {
    const first = dayValue('2025-06-15')
    const last = dayValue('2026-10-01')
    expect(formatTick(first, last - first)).toBe("Jun '25")
    expect(formatTick(last, last - first)).toBe("Oct '26")
  })
})
