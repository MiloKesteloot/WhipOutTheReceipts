import { describe, it, expect } from 'vitest'
import { checkedInByReceipt, receiptsToCheckOff, waitingOn, receiptTotals } from './receiptStatus.js'

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

  it('waits on the payer too, even when they are not listed as a member', () => {
    const r = { ...receipt, members: ['Bob'] }
    const checkedIn = checkedInByReceipt({ checkins: [{ receipt_id: 'r1', roommate: 'Bob' }] })
    expect(waitingOn(r, checkedIn)).toEqual(['Alice'])
  })
})

describe('receiptTotals', () => {
  it('adds items, tip, tax, fees and meal fees', () => {
    const meals = [{ receipt_id: 'r1', fee: 2 }]
    expect(receiptTotals({ receipts: [receipt], items, meals })).toEqual({ r1: 13.5 })
  })
})
