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
