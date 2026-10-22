import { describe, it, expect } from 'vitest'
import { checkedInByReceipt, receiptsToCheckOff, waitingOn, receiptTotals, unclaimedForMe } from './receiptStatus.js'

const receipt = { id: 'r1', paid_by: 'Alice', members: ['Alice', 'Bob'], tip: 1, tax: 0.5, fees: 0 }
const items = [{ id: 'i1', receipt_id: 'r1', price: 10 }]
const claims = [{ item_id: 'i1', roommate: 'Bob' }]

describe('check-in status', () => {
  it('still waits on someone who has claims but no check-in', () => {
    // What a receipt looks like after an edit added items: the claims stay,
    // everyone else's check-in is cleared
    const data = { receipts: [receipt], items, claims, checkins: [{ receipt_id: 'r1', roommate: 'Alice' }] }
    const checkedIn = checkedInByReceipt(data)
    expect(waitingOn(receipt, checkedIn)).toEqual(['Bob'])
    expect(receiptsToCheckOff(data, checkedIn, 'Bob')).toEqual([receipt])
    expect(receiptsToCheckOff(data, checkedIn, 'Alice')).toEqual([])
  })

  it('is done once everyone has checked in', () => {
    const checkins = [{ receipt_id: 'r1', roommate: 'Alice' }, { receipt_id: 'r1', roommate: 'bob' }]
    const data = { receipts: [receipt], items, claims, checkins }
    const checkedIn = checkedInByReceipt(data)
    expect(waitingOn(receipt, checkedIn)).toEqual([])
    expect(receiptsToCheckOff(data, checkedIn, 'Bob')).toEqual([])
  })

  it("doesn't wait on a payer who was taken off the receipt (like balances)", () => {
    const r = { ...receipt, members: ['Bob'] }
    const data = { receipts: [r], items, claims, checkins: [{ receipt_id: 'r1', roommate: 'Bob' }] }
    const checkedIn = checkedInByReceipt(data)
    expect(waitingOn(r, checkedIn)).toEqual([])
    expect(receiptsToCheckOff(data, checkedIn, 'Alice')).toEqual([])
  })
})

describe('unclaimedForMe', () => {
  const r = { ...receipt, members: ['Alice', 'Bob', 'Carol'], splits_unclaimed: true, receipt_date: '2026-11-02' }
  const its = [{ id: 'i1', receipt_id: 'r1', name: 'Milk', price: 6 }, { id: 'i2', receipt_id: 'r1', name: 'Ham', price: 9 }]
  const cl = [{ item_id: 'i1', roommate: 'Bob' }]
  const everyoneIn = ['Alice', 'Bob', 'Carol'].map(roommate => ({ receipt_id: 'r1', roommate }))

  it('lists an item nobody claimed once everyone has checked in, with who it splits between', () => {
    const [u, ...rest] = unclaimedForMe({ receipts: [r], items: its, claims: cl, checkins: everyoneIn }, 'Carol')
    expect(rest).toEqual([])
    expect(u.item.name).toBe('Ham')
    expect(u.everyone).toEqual(['Alice', 'Bob', 'Carol'])
  })

  it('waits until everyone has checked in', () => {
    expect(unclaimedForMe({ receipts: [r], items: its, claims: cl, checkins: everyoneIn.slice(1) }, 'Carol')).toEqual([])
  })

  it("hides it from whoever said it isn't theirs, and tells the others", () => {
    const dismissals = [{ item_id: 'i2', roommate: 'Bob' }]
    const data = { receipts: [r], items: its, claims: cl, checkins: everyoneIn, dismissals }
    expect(unclaimedForMe(data, 'Bob')).toEqual([])
    expect(unclaimedForMe(data, 'Carol')[0].dismissedBy).toEqual(['Bob'])
  })

  it("leaves out receipts that don't split unclaimed items, and people not on the receipt", () => {
    const data = { receipts: [{ ...r, splits_unclaimed: false }], items: its, claims: cl, checkins: everyoneIn }
    expect(unclaimedForMe(data, 'Carol')).toEqual([])
    expect(unclaimedForMe({ ...data, receipts: [r] }, 'Dave')).toEqual([])
  })
})

describe('receiptTotals', () => {
  it('adds items, tip, tax, fees and meal fees', () => {
    const meals = [{ receipt_id: 'r1', fee: 2 }]
    expect(receiptTotals({ receipts: [receipt], items, meals })).toEqual({ r1: 13.5 })
  })
})
