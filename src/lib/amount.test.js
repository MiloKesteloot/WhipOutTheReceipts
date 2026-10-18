import { describe, it, expect } from 'vitest'
import { parseAmount, amountOrZero } from './amount.js'

describe('parseAmount', () => {
  it.each([
    ['4.99', 4.99],
    ['4,99', 4.99],
    ['$5', 5],
    [' $ 12.50 ', 12.5],
    ['1,234.50', 1234.5],
    ['.5', 0.5],
    ['3.', 3],
    ['-2.25', -2.25],
    ['0', 0],
  ])('%s → %s', (typed, value) => {
    expect(parseAmount(typed)).toBe(value)
  })

  it.each(['', 'abc', '4.9.9', '--1', '$', '1-2'])('"%s" is not an amount', typed => {
    expect(parseAmount(typed)).toBeNaN()
  })

  it('treats blank or invalid as 0 where a number is optional', () => {
    expect(amountOrZero('')).toBe(0)
    expect(amountOrZero('x')).toBe(0)
    expect(amountOrZero('2,50')).toBe(2.5)
  })
})
