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
  notify_new_receipt: true, notify_items_added: true, notify_price_up: true, notify_payment: false, detail: 'everything', ...over,
})
const receipt = (over = {}) => ({
  id: 'r1', group_id: G, store_name: 'Safeway', receipt_date: '2026-11-14', deleted_at: null,
  member_ids: [], paid_by_member: 'm-niko', total: 84.2, tax: 1.2, tip: 0, fees: 0,
  items: [{ name: 'Eggs', price: 4 }, { name: 'Steak', price: 79 }], ...over,
})

function ctx({ links = [link()], receipts = [receipt()], members = MEMBERS, checkins = [], notices = [], payments = [], icons } = {}) {
  return {
    icons,
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
// Everything a message says, and every link in it, wherever Discord puts it
// (plain text, an embed, or a card's parts)
function textOf(body) {
  const out = []
  const walk = x => {
    if (Array.isArray(x)) return x.forEach(walk)
    if (x && typeof x === 'object') {
      for (const k of ['content', 'name', 'value', 'title', 'label']) if (typeof x[k] === 'string') out.push(x[k])
      Object.values(x).forEach(walk)
    }
  }
  walk(body)
  return out.join('\n')
}
function urlsOf(body) {
  return JSON.stringify(body).match(/https?:[^"\)]+/g) || []
}

describe('new receipt', () => {
  it('sends one DM with who added it, the store, total and a link', () => {
    const r = row({ kind: 'new_receipt' })
    const out = planSends([r], ctx())
    expect(out.skips).toEqual([])
    expect(out.sends).toHaveLength(1)
    const s = out.sends[0]
    expect(s).toMatchObject({ userId: ME, discordId: 'd-me', ids: [r.id] })
    const t = textOf(s.body)
    expect(t).toContain('**Niko** added **Safeway** · Sat, Nov 14')
    expect(t).toMatch(/TOTAL\s+\$84\.20/)
    expect(t).toContain('-# Paid by Niko · <t:')
    expect(urlsOf(s.body)).toContain(`${APP.replace(/\/$/, '')}/#/receipt/r1`)
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
    expect(textOf(out.sends[0].body)).toContain('added **Safeway**')
  })
})

describe('how much messages include', () => {
  const URL = `${APP.replace(/\/$/, '')}/#/receipt/r1`
  const send = (detail, rows = [row({ kind: 'new_receipt' })], extra = {}) =>
    planSends(rows, ctx({ links: [link({ detail, notify_payment: true })], ...extra })).sends[0].body

  it('everything: a card listing every item with its price, then tax and the total', () => {
    const t = textOf(send('everything'))
    expect(t).toContain([
      '```',
      'Eggs                    4.00',
      'Steak                  79.00',
      'Tax                     1.20',
      '============================',
      'TOTAL                 $84.20',
      '```',
    ].join('\n'))
    const block = t.split('```')[1]
    expect(block).not.toContain('*') // (no "split by everyone" marks)
    expect(t).not.toMatch(/split/i)
  })

  it('everything: only the names are bold, after the store logo; a live "x ago" from when it was added', () => {
    const icons = new Map([['r1', { emoji: '<:store_safeway:42>', url: 'https://logo/safeway' }]])
    const body = send('everything', undefined, { icons, receipts: [receipt({ created_at: '2026-11-14T18:00:00Z' })] })
    const t = textOf(body)
    expect(t).toContain('<:store_safeway:42> **Niko** added **Safeway** · Sat, Nov 14')
    expect(t).toContain(`<t:${Date.parse('2026-11-14T18:00:00Z') / 1000}:R>`)
    expect(JSON.stringify(body)).toContain('"label":"Open"')
  })

  it('everything: no logo emoji (it could not be made) still reads right', () => {
    expect(textOf(send('everything'))).toMatch(/^\*\*Niko\*\* added \*\*Safeway\*\*/m)
  })

  it('everything: a long receipt lists the first 25 items, then how many more', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ name: `Item ${i}`, price: 1 }))
    const t = textOf(send('everything', undefined, { receipts: [receipt({ items })] }))
    expect(t).toContain('Item 24')
    expect(t).not.toContain('Item 25 ')
    expect(t).toContain('…and 5 more')
  })

  it('minimal: store, total, who paid, the date and how many items, but not the items', () => {
    const body = send('minimal')
    const e = body.embeds[0]
    expect(e.author.name).toBe('Niko added a receipt')
    expect(e.title).toBe('Safeway · $84.20')
    expect(e.url).toBe(URL)
    expect(e.fields.map(f => `${f.name}: ${f.value}`)).toEqual(['Paid by: Niko', 'Items: 2', 'Date: Sat, Nov 14'])
    expect(textOf(body)).not.toContain('Steak')
    expect(e.footer).toBeUndefined()
    expect(e.author.icon_url).toBe(`${APP.replace(/\/$/, '')}/icon-192.png`)
  })

  it("minimal: the store's logo beside who added it", () => {
    const icons = new Map([['r1', { emoji: '<:store_safeway:42>', url: 'https://logo/safeway' }]])
    expect(send('minimal', undefined, { icons }).embeds[0].author.icon_url).toBe('https://logo/safeway')
  })

  it('none: one line with a link, and no link preview', () => {
    expect(send('none')).toEqual({ flags: 4, content: `You were added to a [receipt](${URL}).` })
  })

  it('none applies to every kind of message', () => {
    const notices = [{ id: 'n1', kind: 'added', item_name: 'Eggs', seen_at: null },
                     { id: 'n2', kind: 'price', item_name: 'Eggs', old_price: 1, new_price: 2, seen_at: null }]
    const payments = [{ id: 'p1', group_id: G, from_member: 'm-niko', to_member: 'm-me', amount: 5, note: 'hi', receipt_id: null, deleted_at: null }]
    expect(send('none', [row({ kind: 'items_added', notice_id: 'n1' })], { notices }).content).toBe(`Items were added to a [receipt](${URL}) you checked in on.`)
    expect(send('none', [row({ kind: 'price_up', notice_id: 'n2' })], { notices }).content).toBe(`A price went up on a [receipt](${URL}) you checked off.`)
    expect(send('none', [row({ kind: 'payment', payment_id: 'p1', receipt_id: null })], { payments }).content)
      .toBe(`You were sent a [payment](${APP.replace(/\/$/, '')}/#/balances).`)
    expect(msg.reminder({ appUrl: APP, receipts: [{ id: 'r1' }, { id: 'r2' }], detail: 'none' }).content)
      .toBe(`2 receipts are waiting on you in [OurReceipts](${APP.replace(/\/$/, '')}/#/).`)
  })

  it("people's text can't break the card's receipt block", () => {
    const t = textOf(send('everything', undefined, { receipts: [receipt({ items: [{ name: '```oops```', price: 1 }] })] }))
    expect(t.match(/```/g)).toHaveLength(2)
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

describe('store logos', async () => {
  const { findStore, storeLogoUrl } = await import('../_shared/stores.js')
  it('finds a store from its receipt name, like the website does', () => {
    expect(findStore('SAFEWAY #1234')?.domain).toBe('safeway.com')
    expect(findStore('Costco Wholesale')?.domain).toBe('costco.com')
    expect(findStore('Corner Market')).toBeNull()
    expect(storeLogoUrl('costco.com', 64)).toBe('https://www.google.com/s2/favicons?domain=costco.com&sz=64')
  })
})
