import { version } from '../buildVersion.json'

// The app logo (public/icon.svg). ?v= changes every deploy so browsers don't
// keep showing an old logo from cache.
export const LOGO_URL = `${import.meta.env.BASE_URL}icon.svg?v=${version}`
