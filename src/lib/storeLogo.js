import { findStore, storeLogoUrl } from '../../supabase/functions/_shared/stores.js'

// A known store's logo (its site's favicon), or null
export function getStoreLogo(storeName) {
  const store = findStore(storeName)
  return store ? storeLogoUrl(store.domain, 32) : null
}
