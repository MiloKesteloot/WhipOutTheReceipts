import { describe, it, expect } from 'vitest'
import { receiptDebts, computeBalances } from './balances.js'

const receipt = {
  id: 'r1', paid_by: 'Alice', members: ['Alice', 'Bob'], store_name: 'Market',
  receipt_date: '2026-11-01', tip: 0, tax: 0, fees: 0, created_at: '2026-11-01T00:00:00Z',
}
const items = [{ id: 'i1', receipt_id: 'r1', price: 10 }]
const claims = [{ item_id: 'i1', roommate: 'Bob' }]
const bothCheckedIn = [{ receipt_id: 'r1', roommate: 'Alice' }, { receipt_id: 'r1', roommate: 'Bob' }]

const payment = (from, to, amount, fields = {}) => ({ id: `${from}-${to}-${amount}`, from, to, amount, receiptId: null, ...fields })

describe('receiptDebts', () => {
  it('counts nothing until everyone on the receipt has checked in', () => {
    const checkins = [{ receipt_id: 'r1', roommate: 'Alice' }]
    expect(receiptDebts({ receipts: [receipt], items, claims, checkins })).toEqual([])
  })

  it('counts the receipt once everyone has checked in', () => {
    expect(receiptDebts({ receipts: [receipt], items, claims, checkins: bothCheckedIn })).toEqual([
      { receiptId: 'r1', label: 'Market', date: '2026-11-01', debtor: 'Bob', creditor: 'Alice', cents: 1000 },
    ])
  })
})

describe('computeBalances', () => {
  const debts = receiptDebts({ receipts: [receipt], items, claims, checkins: bothCheckedIn })

  it('shows the full debt when nothing is paid', () => {
    const b = computeBalances(debts, [])
    expect(b.forPerson('Bob')).toMatchObject([{ person: 'Alice', iOwe: true, amount: 10 }])
    expect(b.forPerson('Alice')).toMatchObject([{ person: 'Bob', iOwe: false, amount: 10 }])
  })

  it('takes payments off what is owed', () => {
    const b = computeBalances(debts, [payment('Bob', 'Alice', 4)])
    expect(b.forPerson('Bob')).toMatchObject([{ person: 'Alice', iOwe: true, amount: 6 }])
    expect(b.remainingFor('r1', 'Bob', 'Alice')).toBe(6)
  })

  it('is settled when the payment matches', () => {
    const b = computeBalances(debts, [payment('Bob', 'Alice', 10)])
    expect(b.forPerson('Bob')).toEqual([])
    expect(b.remainingFor('r1', 'Bob', 'Alice')).toBe(0)
  })

  it('flips the balance when someone overpays', () => {
    const b = computeBalances(debts, [payment('Bob', 'Alice', 15)])
    expect(b.forPerson('Bob')).toMatchObject([{ person: 'Alice', iOwe: false, amount: 5, fromPayments: 5, open: [] }])
  })

  it('nets debts that go both ways', () => {
    const other = { ...debts[0], receiptId: 'r2', debtor: 'Alice', creditor: 'Bob', cents: 300 }
    const b = computeBalances([...debts, other], [])
    expect(b.forPerson('Bob')).toMatchObject([{ person: 'Alice', iOwe: true, amount: 7 }])
  })

  it('matches names regardless of case', () => {
    const b = computeBalances(debts, [payment('bob', 'alice', 4)])
    expect(b.forPerson('BOB')).toMatchObject([{ iOwe: true, amount: 6 }])
  })
})
