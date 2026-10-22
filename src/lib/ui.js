// Shared looks for controls that appear on several pages, so they stay one
// family (popups have their own in popup.js).

// Money as people read it: "$1,234.56", "-$5.00"
export const money = n => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

// Text fields: one height, radius, border and focus ring everywhere
// (phones get 16px text from index.css, so iOS doesn't zoom in)
export const FIELD = 'w-full h-11 sm:h-10 border border-gray-300 rounded-lg px-3 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-accent-400 disabled:bg-gray-50'
export const FIELD_ERROR = '!border-red-400'

// Chips: tall enough to tap on a phone, compact on desktop
const CHIP = 'inline-flex items-center gap-1 h-10 sm:h-8 px-3 rounded-full text-sm font-medium border transition-colors active:scale-[0.97] select-none'
// Several can be on (people on a receipt, Stats filters): filled with ✓ / white with +
export const toggleChip = on => `${CHIP} pl-2.5 ${on
  ? 'bg-accent-600 text-white border-accent-600 hover:bg-accent-700'
  : 'bg-white text-gray-600 border-gray-300 hover:border-accent-400 hover:text-accent-700'}`
// One of a set (category, who you're checking off for): outlined when chosen
export const choiceChip = on => `${CHIP} ${on
  ? 'bg-accent-50 text-accent-700 border-accent-400'
  : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400 hover:text-gray-800'}`

// "Mark sent" (you pay) and "Mark received" (you were paid): the same pair
// on Home, Balances and receipt pages, the same width so amounts line up
const SETTLE = 'inline-flex items-center justify-center shrink-0 h-9 sm:h-8 px-3 rounded-lg text-sm font-medium transition disabled:opacity-50'
export const SETTLE_SENT = `${SETTLE} min-w-[7.5rem] bg-accent-600 text-white hover:bg-accent-700 active:bg-accent-700`
export const SETTLE_RECEIVED = `${SETTLE} min-w-[7.5rem] bg-white border border-accent-300 text-accent-700 hover:bg-accent-50 active:bg-accent-100`
// Smaller, for one receipt inside a person's balance
export const SETTLE_SMALL = `${SETTLE} bg-white border border-accent-300 text-accent-700 hover:bg-accent-50 active:bg-accent-100`
