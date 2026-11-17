// Known stores: name keywords → the store's website, whose favicon is its
// logo. Shared by the app (src/lib/storeLogo.js, through src/config.js) and
// the Discord bot (supabase/functions/discord), so a store added here gets
// its logo in both. Add rows here to support more stores.
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

// A store's entry, from a receipt's store name, or null
export function findStore(storeName) {
  if (!storeName) return null
  const lower = String(storeName).toLowerCase()
  return STORE_DOMAINS.find(({ keywords }) => keywords.some(k => lower.includes(k))) || null
}

// Its logo: the site's favicon, from Google's favicon service
export const storeLogoUrl = (domain, size = 32) => `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`
