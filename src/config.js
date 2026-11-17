// ─────────────────────────────────────────────────────────────
//  App Config
//  Edit this file to customise the app without touching
//  any other source files.
// ─────────────────────────────────────────────────────────────

// ── Branding ─────────────────────────────────────────────────
export const APP_NAME = 'OurReceipts'
export const APP_TAGLINE = 'Fair grocery splits for roommates.'

// ── Accent color ─────────────────────────────────────────────
// The accent color is controlled by CSS variables in src/index.css.
// Change --accent-* there and the whole app updates.
// Current presets (copy the block you want into index.css):
//
//   Green  → already set as default
//   Blue   → 219 234 254 / 191 219 254 / 147 197 253 / 96 165 250 / 59 130 246 / 37 99 235 / 29 78 216
//   Purple → 237 233 254 / 221 214 254 / 196 181 253 / 167 139 250 / 139 92 246 / 124 58 237 / 109 40 217
//   Pink   → 253 242 248 / 252 231 243 / 249 168 212 / 244 114 182 / 236 72 153 / 219 39 119 / 190 24 93

// ── Receipt categories ────────────────────────────────────────
// label     — shown in the UI
// color     — Tailwind classes for the badge (bg + text)
// chartColor — hex used in the Stats donut chart
export const CATEGORIES = [
  { label: 'Groceries',      color: 'bg-green-100 text-green-700',   chartColor: '#10b981' },
  { label: 'Dining',         color: 'bg-orange-100 text-orange-700', chartColor: '#f59e0b' },
  { label: 'Transportation', color: 'bg-blue-100 text-blue-700',     chartColor: '#3b82f6' },
  { label: 'Misc',           color: 'bg-gray-100 text-gray-600',     chartColor: '#9ca3af' },
]

export const DEFAULT_CATEGORY = 'Groceries'


// ── Receipt scanner ───────────────────────────────────────────
// Gemini model used for receipt photo scanning (must accept images).
// Current stable models: https://ai.google.dev/gemini-api/docs/models
// (gemini-2.0-flash, used before, was shut down by Google.)
export const GEMINI_MODEL = 'gemini-3.8-flash'

// ── Known store logos ─────────────────────────────────────────
// The list lives with the Discord bot, which shows the same logos.
export { STORE_DOMAINS } from '../supabase/functions/_shared/stores.js'
