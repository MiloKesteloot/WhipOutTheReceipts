import { describe, it, expect } from 'vitest'
import { planSends } from './plan.js'
import * as msg from './messages.js'

const APP = 'https://example.github.io/WhipOutTheReceipts/'
const G = 'g1'
const ME = 'u-me', NIKO = 'u-niko'
const MEMBERS = [
  { id: 'm-me', group_id: G, user_id: ME, first_name: 'Milo', active: true },
  { id: 'm-niko', group_id: G, user_id: NIKO, first_name: 'Niko', active: true },
  { id: 'm-alex', group_id: G, user_id: 'u-alex', first_name: 'Alex', active: true },
]
const link = (over = {}) => ({
  user_id: ME, discord_id: 'd-me', broken_at: null,
  notify_new_receipt: true, notify_items_added: true, notify_price_up: true, notify_payment: false, ...over,
})
const receipt = (over = {}) => ({
  id: 'r1', group_id: G, store_name: 'Safeway', receipt_date: '2026-11-14', deleted_at: null,
  member_ids: [], paid_by_member: 'm-niko', total: 84.2, ...over,
})

function ctx({ links = [link()], receipts = [receipt()], members = MEMBERS, checkins = [], notices = [], payments = [] } = {}) {
  return {
    appUrl: APP,
    links: new Map(links.map(l => [l.user_id, l])),
    receipts: new Map(receipts.map(r => [r.id, r])),
    members: new Map(members.map(m => [m.id, m])),
    checkins: new Set(checkins),
    notices: new Map(notices.map(n => [n.id, n])),
    payments: new Map(payments.map(p => [p.id, p])),
  }
}
let nextId = 1
const row = over => ({ id: nextId++, user_id: ME, receipt_id: 'r1', notice_id: null, payment_id: null, actor_member: 'm-niko', ...over })
const skipped = (out, reason) => out.skips.find(s => s.reason === reason)?.ids ?? []

describe('new receipt', () => {
  it('sends one DM with who added it, the store, total and a link', () => {
    const r = row({ kind: 'new_receipt' })
    const out = planSends([r], ctx())
    expect(out.skips).toEqual([])
    expect(out.sends).toHaveLength(1)
    const s = out.sends[0]
    expect(s).toMatchObject({ userId: ME, discordId: 'd-me', ids: [r.id] })
    expect(s.body.content).toContain('**Niko** added a receipt: **Safeway** (Nov 14) · $84.20')
    expect(s.body.components[0].components[0].url).toBe(`${APP.replace(/\/$/, '')}/#/receipt/r1`)
  })

  it('is skipped when the receipt was deleted meanwhile', () => {
    const r = row({ kind: 'new_receipt' })
    expect(skipped(planSends([r], ctx({ receipts: [receipt({ deleted_at: '2026-11-16' })] })), 'receipt deleted')).toEqual([r.id])
  })

  it('is skipped when it is gone entirely', () => {
    const r = row({ kind: 'new_receipt' })
    expect(skipped(planSends([r], ctx({ receipts: [] })), 'receipt deleted')).toEqual([r.id])
  })

  it('is skipped when you were taken off the receipt', () => {
    const r = row({ kind: 'new_receipt' })
    expect(skipped(planSends([r], ctx({ receipts: [receipt({ member_ids: ['m-niko', 'm-alex'] })] })), 'not on the receipt')).toEqual([r.id])
  })

  it('reaches the payer even when they are not on the member list', () => {
    const r = row({ kind: 'new_receipt' })
    const out = planSends([r], ctx({ receipts: [receipt({ member_ids: ['m-alex'], paid_by_member: 'm-me' })] }))
    expect(out.sends).toHaveLength(1)
  })

  it('is skipped when you already checked in', () => {
    const r = row({ kind: 'new_receipt' })
    expect(skipped(planSends([r], ctx({ checkins: ['r1:m-me'] })), 'already checked in')).toEqual([r.id])
  })

  it('is skipped when you left the group', () => {
    const r = row({ kind: 'new_receipt' })
    const members = MEMBERS.map(m => m.id === 'm-me' ? { ...m, active: false } : m)
    expect(skipped(planSends([r], ctx({ members })), 'not in the group')).toEqual([r.id])
  })

  it('covers other pings about the same receipt in one message', () => {
    const notices = [{ id: 'n1', kind: 'added', item_name: 'Eggs', seen_at: null }]
    const rows = [row({ kind: 'new_receipt' }), row({ kind: 'items_added', notice_id: 'n1' })]
    const out = planSends(rows, ctx({ notices }))
    expect(out.sends).toHaveLength(1)
    expect(out.sends[0].ids).toEqual(rows.map(r => r.id))
    expect(out.sends[0].body.content).toContain('added a receipt')
  })
})

describe('settings', () => {
  it('skips people who turned that kind off', () => {
    const r = row({ kind: 'new_receipt' })
    expect(skipped(planSends([r], ctx({ links: [link({ notify_new_receipt: false })] })), 'turned off')).toEqual([r.id])
  })

  it('payments are off unless turned on', () => {
    const payments = [{ id: 'p1', group_id: G, from_member: 'm-niko', to_member: 'm-me', amount: 20, note: null, receipt_id: null, deleted_at: null }]
    const r = row({ kind: 'payment', payment_id: 'p1', receipt_id: null })
    expect(skipped(planSends([r], ctx({ payments })), 'turned off')).toEqual([r.id])
    const on = planSends([r], ctx({ payments, links: [link({ notify_payment: true })] }))
    expect(on.sends[0].body.content).toContain('**Niko** sent you $20.00')
  })

  it('skips people who disconnected', () => {
    const r = row({ kind: 'new_receipt' })
    expect(skipped(planSends([r], ctx({ links: [] })), 'not connected')).toEqual([r.id])
  })

  it("skips people the bot can't DM", () => {
    const r = row({ kind: 'new_receipt' })
    expect(skipped(planSends([r], ctx({ links: [link({ broken_at: '2026-11-15' })] })), "can't DM them")).toEqual([r.id])
  })
})

describe('items added', () => {
  const notices = [
    { id: 'n1', kind: 'added', item_name: 'Eggs', seen_at: null },
    { id: 'n2', kind: 'added', item_name: 'Milk', seen_at: null },
  ]

  it('lists every added item in one message', () => {
    const rows = [row({ kind: 'items_added', notice_id: 'n1' }), row({ kind: 'items_added', notice_id: 'n2' })]
    const out = planSends(rows, ctx({ notices }))
    expect(out.sends).toHaveLength(1)
    expect(out.sends[0].body.content).toContain('**Niko** added Eggs and Milk to **Safeway**')
    expect(out.sends[0].body.content).toContain('Check in again')
  })

  it('is skipped once you checked in again (the notice is seen)', () => {
    const r = row({ kind: 'items_added', notice_id: 'n1' })
    expect(skipped(planSends([r], ctx({ notices: [{ ...notices[0], seen_at: '2026-11-16' }] })), 'already seen')).toEqual([r.id])
  })

  it('is skipped when the item was removed (its notice is gone)', () => {
    const r = row({ kind: 'items_added', notice_id: 'n1' })
    expect(skipped(planSends([r], ctx({ notices: [] })), 'notice gone')).toEqual([r.id])
  })
})

describe('price went up', () => {
  it('says what it was and what it is', () => {
    const notices = [{ id: 'n1', kind: 'price', item_name: 'Eggs', old_price: 3.99, new_price: 4.99, seen_at: null }]
    const out = planSends([row({ kind: 'price_up', notice_id: 'n1' })], ctx({ notices }))
    expect(out.sends[0].body.content).toContain('Eggs: $3.99 → $4.99')
  })

  it('is skipped when the price came back down', () => {
    const notices = [{ id: 'n1', kind: 'price', item_name: 'Eggs', old_price: 3.99, new_price: 3.49, seen_at: null }]
    const r = row({ kind: 'price_up', notice_id: 'n1' })
    expect(skipped(planSends([r], ctx({ notices })), 'price not higher')).toEqual([r.id])
  })

  it('is a separate message from items added on the same receipt', () => {
    const notices = [
      { id: 'n1', kind: 'price', item_name: 'Eggs', old_price: 3.99, new_price: 4.99, seen_at: null },
      { id: 'n2', kind: 'added', item_name: 'Milk', seen_at: null },
    ]
    const out = planSends([row({ kind: 'price_up', notice_id: 'n1' }), row({ kind: 'items_added', notice_id: 'n2' })], ctx({ notices }))
    expect(out.sends).toHaveLength(2)
  })
})

describe('payments', () => {
  const pay = over => ({ id: 'p1', group_id: G, from_member: 'm-niko', to_member: 'm-me', amount: 12.5, note: null, receipt_id: 'r1', deleted_at: null, ...over })
  const on = { links: [link({ notify_payment: true })] }

  it('says what it was for, and who recorded it if not the payer', () => {
    const out = planSends([row({ kind: 'payment', payment_id: 'p1', actor_member: 'm-alex' })], ctx({ ...on, payments: [pay()] }))
    expect(out.sends[0].body.content).toBe('💸 **Niko** sent you $12.50 for **Safeway** (Nov 14) (recorded by Alex).')
  })

  it('is skipped when the payment was deleted', () => {
    const r = row({ kind: 'payment', payment_id: 'p1' })
    expect(skipped(planSends([r], ctx({ ...on, payments: [pay({ deleted_at: '2026-11-16' })] })), 'payment deleted')).toEqual([r.id])
  })
})

describe('messages', () => {
  it("keeps people's text from becoming formatting or mentions", () => {
    expect(msg.esc('**Big** sale @everyone [x](y)')).toBe('\\*\\*Big\\*\\* sale @​everyone \\[x\\](y)')
  })

  it('lists names naturally', () => {
    expect(msg.listNames(['A'])).toBe('A')
    expect(msg.listNames(['A', 'B'])).toBe('A and B')
    expect(msg.listNames(['A', 'B', 'C'])).toBe('A, B and C')
    expect(msg.listNames(['A', 'B', 'C', 'D', 'E'])).toBe('A, B and 3 more')
  })

  it('reminders link each receipt and cap the list', () => {
    const receipts = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, store_name: `Store ${i}`, receipt_date: '2026-11-01', total: 10 }))
    const { content } = msg.reminder({ appUrl: APP, receipts })
    expect(content).toContain('12 receipts are waiting on you')
    expect(content).toContain('[Store 0](https://example.github.io/WhipOutTheReceipts/#/receipt/r0) (Nov 1) · $10.00')
    expect(content).toContain('…and 2 more')
    expect(msg.reminder({ appUrl: APP, receipts: receipts.slice(0, 1) }).content).toContain('A receipt is waiting on you')
  })

  it('every message fits in a Discord message', () => {
    const long = 'x'.repeat(200)
    const receipts = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, store_name: long, receipt_date: null, total: 1 }))
    expect(msg.reminder({ appUrl: APP, receipts }).content.length).toBeLessThanOrEqual(2000)
    expect(msg.ABOUT_TEXT.length).toBeLessThanOrEqual(2000)
  })
})
