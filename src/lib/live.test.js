import { describe, it, expect } from 'vitest'
import { touchesReceipt, touchesTables } from './liveMatch.js'

const batch = (...events) => ({ all: false, events })
const ev = (table, type, row = {}, old = {}) => ({ table, type, row, old })
const items = new Set(['i1', 'i2'])

describe('which live changes a receipt page reloads for', () => {
  it('"load everything" (back from sleep, reconnected) always counts', () => {
    expect(touchesReceipt({ all: true, events: [] }, 'r1', items)).toBe(true)
  })

  it('the receipt itself, but not another receipt', () => {
    expect(touchesReceipt(batch(ev('receipts', 'UPDATE', { id: 'r1' })), 'r1', items)).toBe(true)
    expect(touchesReceipt(batch(ev('receipts', 'UPDATE', { id: 'r2' })), 'r1', items)).toBe(false)
  })

  it('its items, meals, check-ins and notices (by receipt), not another receipt\'s', () => {
    for (const table of ['items', 'meals', 'checkins', 'receipt_notices']) {
      expect(touchesReceipt(batch(ev(table, 'INSERT', { receipt_id: 'r1' })), 'r1', items)).toBe(true)
      expect(touchesReceipt(batch(ev(table, 'UPDATE', { receipt_id: 'r2' })), 'r1', items)).toBe(false)
    }
  })

  it('check-offs and "not mine"s on its items (by item), not others', () => {
    expect(touchesReceipt(batch(ev('claims', 'INSERT', { item_id: 'i2' })), 'r1', items)).toBe(true)
    expect(touchesReceipt(batch(ev('item_dismissals', 'INSERT', { item_id: 'i1' })), 'r1', items)).toBe(true)
    expect(touchesReceipt(batch(ev('claims', 'INSERT', { item_id: 'x9' })), 'r1', items)).toBe(false)
  })

  it('a deleted row only carries its id, so any delete there counts', () => {
    expect(touchesReceipt(batch(ev('claims', 'DELETE', {}, { id: 'c1' })), 'r1', items)).toBe(true)
    expect(touchesReceipt(batch(ev('checkins', 'DELETE', {}, { id: 'k1' })), 'r1', items)).toBe(true)
  })

  it('people changing (names, who\'s in the group) counts; payments don\'t (the balances reload for those)', () => {
    expect(touchesReceipt(batch(ev('group_members', 'UPDATE', { id: 'm1' })), 'r1', items)).toBe(true)
    expect(touchesReceipt(batch(ev('payments', 'INSERT', { receipt_id: 'r1' })), 'r1', items)).toBe(false)
  })

  it('one matching change in a batch is enough', () => {
    expect(touchesReceipt(batch(ev('receipts', 'UPDATE', { id: 'r2' }), ev('claims', 'INSERT', { item_id: 'i1' })), 'r1', items)).toBe(true)
  })
})

describe('touchesTables', () => {
  it('matches by table, and "load everything" matches all', () => {
    expect(touchesTables(batch(ev('payments', 'INSERT')), ['payments'])).toBe(true)
    expect(touchesTables(batch(ev('payments', 'INSERT')), ['claims'])).toBe(false)
    expect(touchesTables({ all: true, events: [] }, ['claims'])).toBe(true)
  })
})
