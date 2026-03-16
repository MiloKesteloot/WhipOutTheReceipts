// ─────────────────────────────────────────────────────────────
//  App Config
//  Edit this file to customise the app without touching
//  any other source files.
// ─────────────────────────────────────────────────────────────

// ── Branding ─────────────────────────────────────────────────
export const APP_NAME = 'Receipts'
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

// ── Fallback core roommates ───────────────────────────────────
// Used if the apartment roster hasn't been set up in Settings yet.
export const FALLBACK_MEMBERS = ['Alex', 'Clouey', 'Milo', 'Niko']

// ── Stats chart settings ──────────────────────────────────────
// Maximum characters to show for a trip name in bar/line charts.
export const CHART_TRIP_NAME_LENGTH = 14

// ── Receipt scanner ───────────────────────────────────────────
// Gemini model used for receipt photo scanning.
// Options: 'gemini-2.0-flash' | 'gemini-1.5-flash' | 'gemini-1.5-pro'
export const GEMINI_MODEL = 'gemini-2.0-flash'

// ── Known store logos ─────────────────────────────────────────
// Maps store name keywords → domain for favicon lookup.
// Add rows here to support more stores.
export const STORE_DOMAINS = [
  { keywords: ['trader joe', "trader joe's"],                domain: 'traderjoes.com' },
  { keywords: ['whole foods', 'wholefoods'],                 domain: 'wholefoodsmarket.com' },
  { keywords: ['walmart', 'wal-mart', 'wal mart'],           domain: 'walmart.com' },
  { keywords: ['target'],                                    domain: 'target.com' },
  { keywords: ['costco'],                                    domain: 'costco.com' },
  { keywords: ['kroger'],                                    domain: 'kroger.com' },
  { keywords: ['safeway'],                                   domain: 'safeway.com' },
  { keywords: ['aldi'],                                      domain: 'aldi.us' },
  { keywords: ['publix'],                                    domain: 'publix.com' },
  { keywords: ['sprouts'],                                   domain: 'sprouts.com' },
  { keywords: ['wegmans'],                                   domain: 'wegmans.com' },
  { keywords: ['heb', 'h-e-b', 'h.e.b'],                    domain: 'heb.com' },
  { keywords: ['meijer'],                                    domain: 'meijer.com' },
  { keywords: ['food lion'],                                 domain: 'foodlion.com' },
  { keywords: ['shoprite'],                                  domain: 'shoprite.com' },
  { keywords: ['starbucks'],                                 domain: 'starbucks.com' },
  { keywords: ['chipotle'],                                  domain: 'chipotle.com' },
  { keywords: ["mcdonald's", 'mcdonalds'],                   domain: 'mcdonalds.com' },
  { keywords: ['doordash'],                                  domain: 'doordash.com' },
  { keywords: ['uber eats', 'ubereats'],                     domain: 'ubereats.com' },
  { keywords: ['amazon'],                                    domain: 'amazon.com' },
  { keywords: ['cvs'],                                       domain: 'cvs.com' },
  { keywords: ['walgreens'],                                 domain: 'walgreens.com' },
  { keywords: ['instacart'],                                 domain: 'instacart.com' },
  { keywords: ['stop & shop', 'stop and shop'],              domain: 'stopandshop.com' },
  { keywords: ['giant'],                                     domain: 'giantfood.com' },
  { keywords: ['hannaford'],                                 domain: 'hannaford.com' },
  { keywords: ['ralphs', "ralph's"],                         domain: 'ralphs.com' },
  { keywords: ['jewel', 'jewel osco', 'jewel-osco'],         domain: 'jewelosco.com' },
]
