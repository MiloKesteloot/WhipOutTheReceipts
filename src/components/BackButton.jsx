// The one back button style used across the app
export default function BackButton({ onClick, children = 'Back', className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 hover:bg-gray-50 px-2.5 py-1 rounded-lg transition ${className}`}
    >
      ← {children}
    </button>
  )
}
