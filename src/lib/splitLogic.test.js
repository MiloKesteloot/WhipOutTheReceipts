import { describe, it, expect } from 'vitest'
import { calculateDebts, splitItemCents } from './splitLogic.js'

// Created after both rounding cutoffs, so the current rules apply
const NEW = '2026-11-01T00:00:00Z'

const receipt = (fields = {}) => ({ id: 'r1', paid_by: 'Alice', tip: 0, tax: 0, fees: 0, created_at: NEW, ...fields })
const item = (id, price, fields = {}) => ({ id, receipt_id: 'r1', price, name: id, ...fields })
const claim = (item_id, roommate) => ({ item_id, roommate })

// { debtor: dollars } for everyone who owes the payer
function owed(receipts, items, claims, meals) {
  return Object.fromEntries(calculateDebts(receipts, items, claims, meals).map(d => [d.debtor, d.amount]))
}

describe('splitItemCents', () => {
  it('hands leftover cents to the first claimers and adds up to the price', () => {
    const split = splitItemCents(10, ['Alice', 'Bob', 'Carol'])
    expect(split).toEqual([['Alice', 334], ['Bob', 333], ['Carol', 333]])
    expect(split.reduce((s, [, c]) => s + c, 0)).toBe(1000)
  })
})

describe('calculateDebts', () => {
  it('splits a shared item between its claimers', () => {
    expect(owed([receipt()], [item('milk', 6)], [claim('milk', 'Alice'), claim('milk', 'Bob')]))
      .toEqual({ Bob: 3 })
  })

  it('creates no debt for what the payer claimed', () => {
    expect(owed([receipt()], [item('milk', 6)], [claim('milk', 'Alice')])).toEqual({})
  })

  it('leaves unclaimed items with the payer', () => {
    expect(owed([receipt()], [item('milk', 6)], [])).toEqual({})
  })

  it('keeps the tax on unclaimed items with the payer', () => {
    // Bob claims $10 of a $100 receipt, so he pays 10% of the $10 tax
    const items = [item('milk', 10), item('steak', 90)]
    expect(owed([receipt({ tax: 10 })], items, [claim('milk', 'Bob')])).toEqual({ Bob: 11 })
  })

  it('keeps the old fee split on receipts created before the fix', () => {
    const old = receipt({ tax: 10, created_at: '2026-10-18T15:00:00Z' })
    const items = [item('milk', 10), item('steak', 90)]
    expect(owed([old], items, [claim('milk', 'Bob')])).toEqual({ Bob: 20 })
  })

  it('splits tax by spend and gives the leftover cent out fairly', () => {
    // $1.00 tax over three equal shares: 34¢ + 33¢ + 33¢. The first share
    // (Alice, the payer) takes the extra cent.
    const items = [item('a', 10), item('b', 10), item('c', 10)]
    const claims = [claim('a', 'Alice'), claim('b', 'Bob'), claim('c', 'Carol')]
    expect(owed([receipt({ tax: 1 })], items, claims)).toEqual({ Bob: 10.33, Carol: 10.33 })
  })

  it('treats tip, tax and fees together', () => {
    const items = [item('a', 10), item('b', 10)]
    const claims = [claim('a', 'Alice'), claim('b', 'Bob')]
    expect(owed([receipt({ tip: 2, tax: 1, fees: 1 })], items, claims)).toEqual({ Bob: 12 })
  })

  it('gives the leftover cent by claim id, whatever order the claims came in', () => {
    // $10.00 three ways: the earliest claim id gets $3.34
    const claims = [
      { id: 'c', item_id: 'x', roommate: 'Carol' },
      { id: 'a', item_id: 'x', roommate: 'Bob' },
      { id: 'b', item_id: 'x', roommate: 'Alice' },
    ]
    const expected = { Bob: 3.34, Carol: 3.33 }
    expect(owed([receipt()], [item('x', 10)], claims)).toEqual(expected)
    expect(owed([receipt()], [item('x', 10)], [...claims].reverse())).toEqual(expected)
  })

  it('has the payer owe someone whose lines are mostly a discount', () => {
    // Bob claims only a $5 coupon: Alice (the payer) owes him $5
    const debts = calculateDebts([receipt()], [item('steak', 15), item('coupon', -5)], [claim('steak', 'Alice'), claim('coupon', 'Bob')])
    expect(debts).toEqual([{ debtor: 'Alice', creditor: 'Bob', amount: 5 }])
  })

  it('credits tax back on a discount, so tax shares add up to the tax', () => {
    // Carol $15 item, Bob -$5 coupon, $1 tax over $10 net: Carol $1.50, Bob −$0.50
    const items = [item('a', 15), item('coupon', -5)]
    const claims = [claim('a', 'Carol'), claim('coupon', 'Bob')]
    const debts = calculateDebts([receipt({ tax: 1 })], items, claims)
    expect(debts).toEqual(expect.arrayContaining([
      { debtor: 'Carol', creditor: 'Alice', amount: 16.5 },
      { debtor: 'Alice', creditor: 'Bob', amount: 5.5 },
    ]))
  })

  it('splits a meal fee over that meal\'s items, unclaimed ones staying with the payer', () => {
    const items = [item('pizza', 10, { meal_id: 'm1' }), item('wings', 10, { meal_id: 'm1' })]
    const meals = [{ id: 'm1', receipt_id: 'r1', fee: 4, name: 'Dinner' }]
    expect(owed([receipt()], items, [claim('pizza', 'Bob')], meals)).toEqual({ Bob: 12 })
  })
})
