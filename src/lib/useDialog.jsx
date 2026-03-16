import { useState, useCallback } from 'react'

/**
 * useDialog()
 * Returns { confirm, alert: showAlert, DialogUI }
 *
 * confirm(message, options?) → Promise<boolean>
 * showAlert(message, options?) → Promise<void>
 *
 * Options:
 *   title        — bold heading above the message
 *   confirmLabel — label for the confirm button (default 'Confirm')
 *   cancelLabel  — label for the cancel button (default 'Cancel')
 *   danger       — use red confirm button instead of green
 */
export function useDialog() {
  const [dialog, setDialog] = useState(null)

  const confirm = useCallback((message, options = {}) => {
    return new Promise(resolve => {
      setDialog({ type: 'confirm', message, resolve, ...options })
    })
  }, [])

  const showAlert = useCallback((message, options = {}) => {
    return new Promise(resolve => {
      setDialog({ type: 'alert', message, resolve, ...options })
    })
  }, [])

  function handleConfirm() {
    dialog.resolve(true)
    setDialog(null)
  }

  function handleCancel() {
    dialog.resolve(false)
    setDialog(null)
  }

  const DialogUI = dialog ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
        {dialog.title && (
          <h2 className="font-semibold text-gray-900 mb-2">{dialog.title}</h2>
        )}
        <p className="text-sm text-gray-600 leading-relaxed">{dialog.message}</p>
        <div className="flex gap-2 mt-5 justify-end">
          {dialog.type === 'confirm' && (
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition"
            >
              {dialog.cancelLabel || 'Cancel'}
            </button>
          )}
          <button
            onClick={handleConfirm}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
              dialog.danger
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'bg-accent-600 text-white hover:bg-accent-700'
            }`}
          >
            {dialog.type === 'alert' ? (dialog.confirmLabel || 'OK') : (dialog.confirmLabel || 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  ) : null

  return { confirm, showAlert, DialogUI }
}
