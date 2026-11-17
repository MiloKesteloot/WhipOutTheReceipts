// Deciding what to send from the queued rows (notification_outbox). Plain
// JS, no Discord or database, so it's unit-tested (plan.test.js).
//
// Rows are checked again here, a minute or more after they were queued:
// things change. A row is skipped (with a reason) when:
//   - the person disconnected Discord, turned that kind off, or DMs to
//     them are failing
//   - the receipt was deleted, or they're no longer on it / in the group
//   - they already did what the ping asks (checked in; saw the notice)
//   - a price is no longer higher than what they checked off
//   - the payment was deleted
// Several rows about one receipt for one person become one message, and a
// "new receipt" covers any other pings about the same receipt.
import * as msg from './messages.js'

const PREF = {
  new_receipt: 'notify_new_receipt',
  items_added: 'notify_items_added',
  price_up: 'notify_price_up',
  payment: 'notify_payment',
}

// ctx: { appUrl, links: Map(userId → link), receipts: Map(id → receipt with total),
//        members: Map(memberId → member), checkins: Set('receiptId:memberId'),
//        notices: Map(id → notice with item_name), payments: Map(id → payment) }
// → { sends: [{ userId, discordId, ids, body }], skips: [{ ids, reason }] }
export function planSends(rows, ctx) {
  const skips = new Map() // reason → ids
  const skip = (row, reason) => { if (!skips.has(reason)) skips.set(reason, []); skips.get(reason).push(row.id) }
  const memberOf = (userId, groupId) =>
    [...ctx.members.values()].find(m => m.user_id === userId && m.group_id === groupId && m.active)
  const nameOf = id => ctx.members.get(id)?.first_name || null

  const groups = new Map() // `${userId}:${receiptId or payment:id}` → rows
  for (const row of rows) {
    const link = ctx.links.get(row.user_id)
    if (!link) { skip(row, 'not connected'); continue }
    if (link.broken_at) { skip(row, "can't DM them"); continue }
    if (!link[PREF[row.kind]]) { skip(row, 'turned off'); continue }

    if (row.kind === 'payment') {
      const p = ctx.payments.get(row.payment_id)
      if (!p || p.deleted_at) { skip(row, 'payment deleted'); continue }
      if (!memberOf(row.user_id, p.group_id)) { skip(row, 'not in the group'); continue }
      groups.set(`${row.user_id}:payment:${row.payment_id}`, [row])
      continue
    }

    const r = ctx.receipts.get(row.receipt_id)
    if (!r || r.deleted_at) { skip(row, 'receipt deleted'); continue }
    const me = memberOf(row.user_id, r.group_id)
    if (!me) { skip(row, 'not in the group'); continue }
    const onIt = r.member_ids.length === 0 || r.member_ids.includes(me.id) || r.paid_by_member === me.id
    if (!onIt) { skip(row, 'not on the receipt'); continue }

    if (row.kind === 'new_receipt') {
      if (ctx.checkins.has(`${r.id}:${me.id}`)) { skip(row, 'already checked in'); continue }
    } else {
      const n = ctx.notices.get(row.notice_id)
      if (!n) { skip(row, 'notice gone'); continue }
      if (n.seen_at) { skip(row, 'already seen'); continue }
      if (row.kind === 'price_up' && !(Number(n.new_price) > Number(n.old_price))) { skip(row, 'price not higher'); continue }
    }
    const key = `${row.user_id}:${r.id}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }

  const sends = []
  for (const group of groups.values()) {
    const first = group[0]
    const link = ctx.links.get(first.user_id)
    const latestActor = rows => nameOf([...rows].sort((a, b) => b.id - a.id).find(x => x.actor_member)?.actor_member)

    if (first.kind === 'payment') {
      const p = ctx.payments.get(first.payment_id)
      const receipt = p.receipt_id ? ctx.receipts.get(p.receipt_id) : null
      sends.push({ userId: first.user_id, discordId: link.discord_id, ids: [first.id],
        body: msg.paymentToYou({ appUrl: ctx.appUrl, actor: nameOf(first.actor_member), from: nameOf(p.from_member),
          amount: p.amount, note: p.note, receipt: receipt && !receipt.deleted_at ? receipt : null }) })
      continue
    }

    const receipt = ctx.receipts.get(first.receipt_id)
    const fresh = group.filter(x => x.kind === 'new_receipt')
    if (fresh.length) {
      sends.push({ userId: first.user_id, discordId: link.discord_id, ids: group.map(x => x.id),
        body: msg.newReceipt({ appUrl: ctx.appUrl, receipt, actor: nameOf(fresh[0].actor_member), total: receipt.total }) })
      continue
    }
    const added = group.filter(x => x.kind === 'items_added')
    if (added.length) {
      const items = [...new Set(added.map(x => ctx.notices.get(x.notice_id).item_name).filter(Boolean))]
      sends.push({ userId: first.user_id, discordId: link.discord_id, ids: added.map(x => x.id),
        body: msg.itemsAdded({ appUrl: ctx.appUrl, receipt, actor: latestActor(added), items }) })
    }
    const prices = group.filter(x => x.kind === 'price_up')
    if (prices.length) {
      const byNotice = new Map(prices.map(x => [x.notice_id, ctx.notices.get(x.notice_id)]))
      const changes = [...byNotice.values()].map(n => ({ name: n.item_name, old_price: n.old_price, new_price: n.new_price }))
      sends.push({ userId: first.user_id, discordId: link.discord_id, ids: prices.map(x => x.id),
        body: msg.pricesUp({ appUrl: ctx.appUrl, receipt, actor: latestActor(prices), changes }) })
    }
  }

  return { sends, skips: [...skips].map(([reason, ids]) => ({ reason, ids })) }
}
