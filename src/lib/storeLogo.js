import { STORE_DOMAINS } from '../config.js'

// A known store's logo (its site's favicon), or null
export function getStoreLogo(storeName) {
  if (!storeName) return null
  const lower = storeName.toLowerCase()
  const match = STORE_DOMAINS.find(({ keywords }) => keywords.some(k => lower.includes(k)))
  return match ? `https://www.google.com/s2/favicons?domain=${match.domain}&sz=32` : null
}
