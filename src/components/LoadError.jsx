// Shown when a page's data couldn't load (offline, server down), instead
// of "Loading…" forever
export default function LoadError({ onRetry }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <p className="font-semibold text-gray-800">Couldn't load this page</p>
      <p className="text-sm text-gray-400 mt-1">Check your connection and try again.</p>
      <button onClick={onRetry} className="mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-accent-600 text-white hover:bg-accent-700 transition">
        Try again
      </button>
    </div>
  )
}

// Shown above data that's already on screen when refreshing it failed, so
// old amounts aren't mistaken for current ones
export function StaleNotice({ onRetry }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
      <span>Couldn't refresh. These amounts may be out of date.</span>
      <button onClick={onRetry} className="shrink-0 font-medium text-amber-900 hover:underline">Try again</button>
    </div>
  )
}
