import { useState } from 'react'
import { Link } from 'react-router-dom'
import { appBaseUrl } from '../lib/supabase.js'
import { useGroup } from '../lib/group.jsx'
import { copyText } from '../lib/clipboard.js'

// The first steps in a group: add a receipt, invite the roommates. Home
// shows both while the group has no receipts, and just the invite while
// nobody else is in it.
export default function GetStarted({ showAddReceipt = true }) {
  const { group } = useGroup()
  const [copied, setCopied] = useState(false)
  const inviteLink = `${appBaseUrl}#/join/${group.invite_code}`

  async function copy() {
    if (!await copyText(inviteLink)) { window.prompt('Copy this invite link:', inviteLink); return }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">
      {showAddReceipt && (
        <div>
          <h2 className="font-semibold text-gray-900 text-lg">Welcome to {group.name}</h2>
          <p className="text-sm text-gray-500 mt-1">Add a receipt, then everyone checks off what they had and OurReceipts works out who owes what.</p>
        </div>
      )}
      {showAddReceipt && (
        <Link to="/receipt/new" className="flex items-center justify-center w-full py-3 bg-accent-600 text-white font-semibold rounded-xl hover:bg-accent-700 transition">
          Add your first receipt
        </Link>
      )}
      <div className={showAddReceipt ? 'pt-5 border-t border-gray-100' : ''}>
        <p className="font-medium text-gray-800">Invite your roommates</p>
        <p className="text-sm text-gray-500 mt-0.5">Send them this link. They make a free account and join {group.name}.</p>
        <div className="flex gap-2 mt-3">
          <input readOnly value={inviteLink} onFocus={e => e.target.select()} aria-label="Invite link"
            className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-500 bg-gray-50" />
          <button onClick={copy} className="px-4 py-2 text-sm font-medium bg-accent-600 text-white rounded-lg hover:bg-accent-700 transition shrink-0">
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
        <Link to="/group" className="inline-block mt-2 text-xs text-gray-400 hover:text-gray-600">
          Or add people by name in group settings →
        </Link>
      </div>
    </section>
  )
}
