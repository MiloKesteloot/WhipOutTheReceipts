import { useState, useCallback, useRef } from 'react'
import Modal from '../components/Modal.jsx'

/**
 * useDialog()
 * Returns { confirm, showAlert, DialogUI }
 *
 * confirm(message, options?) → Promise<boolean>
 * showAlert(message, options?) → Promise<void>
 *
 * Options:
 *   title        — bold heading above the message
 *   confirmLabel — label for the confirm button (default 'Confirm')
 *   cancelLabel  — label for the cancel button (default 'Cancel')
 *   danger       — use red confirm button instead of green
 *
 * Focus starts on the safe choice: Cancel for a danger confirm, else the
 * main button. Escape or the backdrop cancels (an alert: closes).
 */
export function useDialog() {
  const [dialog, setDialog] = useState(null)
  const pending = useRef(null)

  const open = useCallback((type, message, options) => new Promise(resolve => {
    // A dialog already waiting for an answer is cancelled, not left hanging
    pending.current?.(type === 'confirm' ? false : undefined)
    pending.current = resolve
    setDialog({ type, message, resolve, ...options })
  }), [])

  const confirm = useCallback((message, options = {}) => open('confirm', message, options), [open])
  const showAlert = useCallback((message, options = {}) => open('alert', message, options), [open])

  function finish(answer) {
    const d = dialog
    pending.current = null
    setDialog(null)
    d.resolve(d.type === 'confirm' ? answer : undefined)
  }

  const cancelRef = useRef(null)
  const okRef = useRef(null)

  const DialogUI = dialog ? (
    <Modal
      key={`${dialog.type}:${dialog.title}:${dialog.message}`}
      role="alertdialog"
      title={dialog.title}
      onClose={() => finish(false)}
      initialFocus={dialog.type === 'confirm' && dialog.danger ? cancelRef : okRef}
    >
      <p className={`text-sm text-gray-600 leading-relaxed ${dialog.title ? 'mt-2' : ''}`}>{dialog.message}</p>
      <div className="flex gap-2 mt-5 justify-end">
        {dialog.type === 'confirm' && (
          <button
            ref={cancelRef}
            onClick={() => finish(false)}
            className="flex-1 sm:flex-none px-4 h-10 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 active:bg-gray-100 text-gray-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
          >
            {dialog.cancelLabel || 'Cancel'}
          </button>
        )}
        <button
          ref={okRef}
          onClick={() => finish(true)}
          className={`flex-1 sm:flex-none px-4 h-10 text-sm font-medium rounded-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
            dialog.danger
              ? 'bg-red-500 text-white hover:bg-red-600 active:bg-red-600 focus-visible:ring-red-400'
              : 'bg-accent-600 text-white hover:bg-accent-700 active:bg-accent-700 focus-visible:ring-accent-400'
          }`}
        >
          {dialog.type === 'alert' ? (dialog.confirmLabel || 'OK') : (dialog.confirmLabel || 'Confirm')}
        </button>
      </div>
    </Modal>
  ) : null

  return { confirm, showAlert, DialogUI }
}
