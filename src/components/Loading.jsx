import { LOGO_URL } from '../lib/logo.js'

// Every "loading" in the app looks the same: a small spinner in the middle
// of where the content will be. It waits ~0.3s before showing, so a fast or
// cached load never flashes it.
export function PageLoading({ className = 'py-24' }) {
  return (
    <div className={`flex justify-center ${className}`} role="status" aria-label="Loading">
      {/* Two elements: one animation each (the wait, then the spin) */}
      <span className="animate-appear-late">
        <span className="block w-5 h-5 rounded-full border-2 border-gray-200 border-t-accent-500 animate-spin" />
      </span>
    </div>
  )
}

// Before the app itself can show (signing in, loading your groups): the
// logo, also after a short wait
export function FullPageLoading() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center" role="status" aria-label="Loading">
      <div className="animate-appear-late flex flex-col items-center gap-4">
        <img src={LOGO_URL} alt="" width={48} height={48} className="w-12 h-12" />
        <span className="w-5 h-5 rounded-full border-2 border-gray-200 border-t-accent-500 animate-spin" />
      </div>
    </div>
  )
}
