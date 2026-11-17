// What the OurReceipts bot says in a DM. No Discord or database here (plain
// JS, so the Edge Function and the unit tests share it):
// supabase/functions/discord/messages.test.js.
//
// Each builder returns a Discord message body: { content, components }.
// Links open the app at the receipt (the app switches to its group).

export const money = n => `$${(Math.round(Number(n || 0) * 100) / 100).toFixed(2)}`

// Names and items come from people; keep them from turning into
// formatting, links or mentions
export function esc(s) {
  // (# and - only mean something at the start of a line, and a name never
  // starts one here)
  return String(s ?? '').replace(/[\\*_~`|>[\]]/g, c => `\\${c}`).replace(/@/g, '@​')
}

// Long names are cut short, so a message stays under Discord's 2000 characters
export const clip = (s, n = 60) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function shortDate(d) {
  if (!d) return ''
  const [, m, day] = String(d).slice(0, 10).split('-').map(Number)
  return `${MONTHS[m - 1]} ${day}`
}

export const receiptUrl = (appUrl, id) => `${appUrl.replace(/\/+$/, '')}/#/receipt/${id}`

const button = (label, url) => ({ type: 1, components: [{ type: 2, style: 5, label, url }] })

// "Safeway (Oct 4)" or "Safeway"
function receiptName(r) {
  const date = shortDate(r.receipt_date)
  return `**${esc(clip(r.store_name))}**${date ? ` (${date})` : ''}`
}

// "Eggs", "Eggs and Milk", "Eggs, Milk and 3 more"
export function listNames(names, max = 3) {
  const n = names.map(x => esc(clip(x, 40)))
  if (n.length <= 1) return n[0] || ''
  if (n.length <= max) return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`
  return `${n.slice(0, max - 1).join(', ')} and ${n.length - max + 1} more`
}

// A new receipt you're on
export function newReceipt({ appUrl, receipt, actor, total }) {
  return {
    content: `🧾 ${actor ? `**${esc(actor)}** added` : 'New'} a receipt: ${receiptName(receipt)} · ${money(total)}\nCheck off what's yours.`,
    components: [button('Open receipt', receiptUrl(appUrl, receipt.id))],
  }
}

// Items added (or newly split by everyone) after you checked in
export function itemsAdded({ appUrl, receipt, actor, items }) {
  const what = items.length ? listNames(items) : 'items'
  return {
    content: `➕ ${actor ? `**${esc(actor)}**` : 'Someone'} added ${what} to ${receiptName(receipt)}.\nCheck in again so your total is right.`,
    components: [button('Open receipt', receiptUrl(appUrl, receipt.id))],
  }
}

// Prices that went up on things you checked off: [{ name, old_price, new_price }]
export function pricesUp({ appUrl, receipt, actor, changes }) {
  const who = actor ? `**${esc(actor)}**` : 'Someone'
  const lines = changes.map(c => `• ${esc(clip(c.name, 60))}: ${money(c.old_price)} → ${money(c.new_price)}`)
  return {
    content: `💲 ${who} raised ${changes.length === 1 ? 'a price' : 'prices'} on ${receiptName(receipt)}, on something you checked off:\n${lines.join('\n')}`,
    components: [button('Open receipt', receiptUrl(appUrl, receipt.id))],
  }
}

// Someone recorded a payment to you
export function paymentToYou({ appUrl, actor, from, amount, receipt, note }) {
  const payer = from || actor
  const forWhat = receipt ? ` for ${receiptName(receipt)}` : ''
  const by = actor && from && actor !== from ? ` (recorded by ${esc(actor)})` : ''
  return {
    content: `💸 **${esc(payer || 'Someone')}** sent you ${money(amount)}${forWhat}${by}.${note ? `\n> ${esc(clip(note, 300))}` : ''}`,
    components: [button('See balances', `${appUrl.replace(/\/+$/, '')}/#/balances`)],
  }
}

// Receipts still waiting on you to check off: [{ id, store_name, receipt_date, total }]
export function reminder({ appUrl, receipts, max = 10 }) {
  const shown = receipts.slice(0, max)
  const lines = shown.map(r => {
    const date = shortDate(r.receipt_date)
    return `• [${esc(clip(r.store_name, 40))}](${receiptUrl(appUrl, r.id)})${date ? ` (${date})` : ''} · ${money(r.total)}`
  })
  if (receipts.length > max) lines.push(`…and ${receipts.length - max} more`)
  return {
    content: `⏰ ${receipts.length === 1 ? 'A receipt is' : `${receipts.length} receipts are`} waiting on you to check off what's yours:\n${lines.join('\n')}`,
    components: [button('Open OurReceipts', `${appUrl.replace(/\/+$/, '')}/#/`)],
  }
}

export function welcome({ appUrl }) {
  return {
    content: "👋 You're connected! I'll message you here about receipts in OurReceipts. You can choose what I message you about in Settings.",
    components: [button('Notification settings', `${appUrl.replace(/\/+$/, '')}/#/settings`)],
  }
}

export function test({ appUrl }) {
  return {
    content: '✅ This is a test message from OurReceipts. Notifications will show up here.',
    components: [button('Open OurReceipts', `${appUrl.replace(/\/+$/, '')}/#/`)],
  }
}

// The one message in the server's #about channel
export const ABOUT_TEXT = [
  '## Why am I in this server?',
  "This server belongs to **OurReceipts**, the app for splitting grocery receipts with roommates.",
  '',
  "Discord only lets a bot message you if you share a server with it. When you connected Discord in OurReceipts, you joined this server so the OurReceipts bot can send you notifications in your DMs: new receipts, items added, price changes and reminders.",
  '',
  "Nothing happens here, and nobody can post. You can mute this server. If you leave it, the bot can't message you anymore.",
  '',
  '**To stop notifications:** in OurReceipts, go to Settings → Discord → Disconnect. That also takes you out of this server.',
].join('\n')
