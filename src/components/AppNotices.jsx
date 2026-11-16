import { useGroup } from '../lib/group.jsx'
import { useNewVersion } from '../lib/appVersion.js'
import { hasUnsavedChanges } from '../lib/unsaved.jsx'
import Modal from './Modal.jsx'

// "New version, tap to refresh": after a deploy, an open copy of the app
// keeps running the old code until reloaded. Sits above the tab bar.
export function NewVersionBar() {
  const newer = useNewVersion()
  if (!newer) return null
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-above-tabbar sm:bottom-4 z-40 w-[calc(100%-2rem)] max-w-sm animate-pop-up" role="status">
      <div className="flex items-center justify-between gap-3 bg-gray-900 text-white text-sm rounded-xl shadow-lg pl-4 pr-1.5 py-1.5">
        <span>A new version of OurReceipts is ready.</span>
        <button
          onClick={() => {
            // Something typed but not saved: the refresh asks first (the
            // browser's own "leave site?"), so nothing is lost
            if (hasUnsavedChanges() && !window.confirm('You have unsaved changes. Refresh anyway?')) return
            window.location.reload()
          }}
          className="shrink-0 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 active:bg-white/25 font-medium transition"
        >
          Refresh
        </button>
      </div>
    </div>
  )
}

// You were removed from the group you were looking at (or it was deleted)
export function LostGroupNotice() {
  const { lostGroup, dismissLostGroup } = useGroup()
  if (!lostGroup) return null
  return (
    <Modal title={`You're no longer in ${lostGroup.name}`} onClose={dismissLostGroup}>
      <p className="text-sm text-gray-500 mt-2">You were removed from it, or it was deleted. Someone in it can invite you back.</p>
      <button onClick={dismissLostGroup} className="mt-5 w-full py-2.5 text-sm font-semibold rounded-xl bg-accent-600 text-white hover:bg-accent-700 active:bg-accent-700 transition">
        OK
      </button>
    </Modal>
  )
}
