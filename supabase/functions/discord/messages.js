// What the OurReceipts bot says in a DM. No Discord or database here (plain
// JS, so the Edge Function and the unit tests share it):
// supabase/functions/discord/plan.test.js.
//
// Each builder returns a Discord message body. Links open the app at the
// receipt (the app switches to its group).
//
// detail is the person's "how much to include" setting:
//   everything  a new receipt shows as a card with its items, the store's
//               logo and a live "x minutes ago"
//   minimal     a new receipt shows as a compact card (no items)
//   none        every message is one line with a link, nothing else
export const DETAILS = ['everything', 'minimal', 'none']

const GREEN = 0x16A34A // the app's accent (accent-600)
const V2 = 1 << 15 // Discord's newer card layout (no `content` with it)
const NO_PREVIEW = 1 << 2 // no link preview under a plain message

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
const linkButton = (label, url) => ({ type: 2, style: 5, label, url })
const text = content => ({ type: 10, content })
const home = appUrl => `${appUrl.replace(/\/+$/, '')}/#/`
const iconUrl = appUrl => `${appUrl.replace(/\/+$/, '')}/icon-192.png`
// "none": one line, one link
const bare = (line, url, label) => ({ flags: NO_PREVIEW, content: line.replace('{link}', `[${label}](${url})`) })

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// "Sat, Nov 16"
export function longDate(d) {
  if (!d) return ''
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number)
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]}, ${MONTHS[m - 1]} ${day}`
}

// Monospace receipt lines: name on the left, price on the right
export const RECEIPT_WIDTH = 28
export function receiptLine(left, right, w = RECEIPT_WIDTH) {
  const room = w - right.length - 1
  const name = String(left ?? '').replace(/`/g, "'").replace(/\s+/g, ' ').trim()
  const l = name.length > room ? `${name.slice(0, room - 1)}…` : name
  return l + ' '.repeat(Math.max(1, w - l.length - right.length)) + right
}
const plain = n => (Math.round(Number(n || 0) * 100) / 100).toFixed(2)

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

// A new receipt you're on.
//   items: [{ name, price }] in order; payer: who paid (a first name)
//   icon: { emoji: '<:store_safeway:123>' or '', url: the store's logo }
//   (the function finds the store's logo and its emoji; see index.ts)
export function newReceipt({ appUrl, receipt, actor, payer, total, items = [], detail = 'everything', icon = {}, maxItems = 25 }) {
  const url = receiptUrl(appUrl, receipt.id)
  if (detail === 'none') return bare('You were added to a {link}.', url, 'receipt')
  const date = longDate(receipt.receipt_date)

  if (detail === 'minimal') {
    return {
      embeds: [{
        color: GREEN,
        // (embed author and title text isn't markdown: no escaping)
        author: { name: actor ? `${actor} added a receipt` : 'New receipt', icon_url: icon.url || iconUrl(appUrl) },
        title: `${clip(receipt.store_name, 80)} · ${money(total)}`,
        url,
        fields: [
          payer && { name: 'Paid by', value: esc(payer), inline: true },
          { name: 'Items', value: String(items.length), inline: true },
          date && { name: 'Date', value: date, inline: true },
        ].filter(Boolean),
      }],
    }
  }

  // everything: "[logo] **Niko** added **Safeway** · Sat, Nov 14", the
  // receipt, then who paid and a live "x minutes ago" beside an Open button
  const store = `**${esc(clip(receipt.store_name))}**`
  const header = `${icon.emoji ? `${icon.emoji} ` : ''}${actor ? `**${esc(actor)}** added ${store}` : `New receipt: ${store}`}${date ? ` · ${date}` : ''}`
  const lines = items.slice(0, maxItems).map(i => receiptLine(i.name, plain(i.price)))
  if (items.length > maxItems) lines.push(`…and ${items.length - maxItems} more`)
  for (const [name, v] of [['Tax', receipt.tax], ['Tip', receipt.tip], ['Fees', receipt.fees]]) {
    if (Number(v)) lines.push(receiptLine(name, plain(v)))
  }
  lines.push('='.repeat(RECEIPT_WIDTH), receiptLine('TOTAL', money(total)))
  const added = Math.floor(new Date(receipt.created_at || Date.now()).getTime() / 1000)
  return {
    flags: V2,
    components: [{ type: 17, accent_color: GREEN, components: [
      text(header),
      text('```\n' + lines.join('\n') + '\n```'),
      { type: 9, components: [text(`-# ${payer ? `Paid by ${esc(payer)} · ` : ''}<t:${added}:R>`)],
        accessory: linkButton('Open', url) },
    ] }],
  }
}

// Items added (or newly split by everyone) after you checked in
export function itemsAdded({ appUrl, receipt, actor, items, detail }) {
  if (detail === 'none') return bare('Items were added to a {link} you checked in on.', receiptUrl(appUrl, receipt.id), 'receipt')
  const what = items.length ? listNames(items) : 'items'
  return {
    content: `➕ ${actor ? `**${esc(actor)}**` : 'Someone'} added ${what} to ${receiptName(receipt)}.\nCheck in again so your total is right.`,
    components: [button('Open receipt', receiptUrl(appUrl, receipt.id))],
  }
}

// Prices that went up on things you checked off: [{ name, old_price, new_price }]
export function pricesUp({ appUrl, receipt, actor, changes, detail }) {
  if (detail === 'none') return bare('A price went up on a {link} you checked off.', receiptUrl(appUrl, receipt.id), 'receipt')
  const who = actor ? `**${esc(actor)}**` : 'Someone'
  const lines = changes.map(c => `• ${esc(clip(c.name, 60))}: ${money(c.old_price)} → ${money(c.new_price)}`)
  return {
    content: `💲 ${who} raised ${changes.length === 1 ? 'a price' : 'prices'} on ${receiptName(receipt)}, on something you checked off:\n${lines.join('\n')}`,
    components: [button('Open receipt', receiptUrl(appUrl, receipt.id))],
  }
}

// Someone recorded a payment to you
export function paymentToYou({ appUrl, actor, from, amount, receipt, note, detail }) {
  if (detail === 'none') return bare('You were sent a {link}.', `${home(appUrl)}balances`, 'payment')
  const payer = from || actor
  const forWhat = receipt ? ` for ${receiptName(receipt)}` : ''
  const by = actor && from && actor !== from ? ` (recorded by ${esc(actor)})` : ''
  return {
    content: `💸 **${esc(payer || 'Someone')}** sent you ${money(amount)}${forWhat}${by}.${note ? `\n> ${esc(clip(note, 300))}` : ''}`,
    components: [button('See balances', `${appUrl.replace(/\/+$/, '')}/#/balances`)],
  }
}

// Receipts still waiting on you to check off: [{ id, store_name, receipt_date, total }]
export function reminder({ appUrl, receipts, max = 10, detail }) {
  const waiting = receipts.length === 1 ? 'A receipt is' : `${receipts.length} receipts are`
  if (detail === 'none') return bare(`${waiting} waiting on you in {link}.`, home(appUrl), 'OurReceipts')
  const shown = receipts.slice(0, max)
  const lines = shown.map(r => {
    const date = shortDate(r.receipt_date)
    return `• [${esc(clip(r.store_name, 40))}](${receiptUrl(appUrl, r.id)})${date ? ` (${date})` : ''} · ${money(r.total)}`
  })
  if (receipts.length > max) lines.push(`…and ${receipts.length - max} more`)
  return {
    flags: NO_PREVIEW, // (its receipt links would each get a preview)
    content: `⏰ ${waiting} waiting on you to check off what's yours:\n${lines.join('\n')}`,
    components: [button('Open OurReceipts', home(appUrl))],
  }
}

export function welcome({ appUrl }) {
  return {
    content: "👋 You're connected! I'll message you here about receipts in OurReceipts. You can choose what I message you about in Settings.",
    components: [button('Notification settings', `${appUrl.replace(/\/+$/, '')}/#/settings`)],
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
