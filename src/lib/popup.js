// Shared look and placement for popups that hang off a button: the Select
// dropdown, the account menu, the ⋯ menu on people. One style everywhere.

// The panel
export const POPUP_PANEL = 'bg-white border border-gray-200 rounded-xl shadow-lg py-1'

// A row in it (hover only applies with a mouse: see tailwind.config.js)
export const POPUP_ITEM = 'w-full text-left px-3 py-2.5 sm:py-2 text-sm transition-colors hover:bg-accent-50 hover:text-accent-700 active:bg-accent-50'

// Destructive actions (remove, ban, unlink): red, set apart at the end
export const POPUP_ITEM_DANGER = 'w-full text-left px-3 py-2.5 sm:py-2 text-sm text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 active:bg-red-50'

// A line between groups of rows
export const POPUP_DIVIDER = 'border-t border-gray-100 my-1'

// The highlighted row (keyboard, or the mouse in a Select)
export const POPUP_ITEM_ACTIVE = 'bg-accent-50 text-accent-700'

// A small heading over a group of rows
export const POPUP_HEADING = 'px-3 pt-2 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wide'

// Rows are about 40px (phones); a list is at most 240px tall (max-h-60)
export const popupHeight = rows => Math.min(240, rows * 40 + 8)

// Should a popup of this height open above `anchor`? Only when it doesn't
// fit below (down to the phone tab bar, if showing) and there's more room above.
export function opensUp(anchor, height) {
  const rect = anchor.getBoundingClientRect()
  const bar = document.querySelector('[data-tabbar]')?.getBoundingClientRect()
  const bottom = bar?.height ? bar.top : window.innerHeight
  const below = bottom - rect.bottom
  return below < height + 8 && rect.top > below
}
