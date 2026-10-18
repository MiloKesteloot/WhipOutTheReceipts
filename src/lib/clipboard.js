// Copy text to the clipboard. `text` can be a promise (e.g. a link that's
// still being created): Safari only allows copying during the tap itself,
// and a ClipboardItem built from a promise keeps that permission while the
// text loads. Resolves true if it was copied, false if the browser refused.
export async function copyText(text) {
  try {
    if (typeof text !== 'string' && window.ClipboardItem && navigator.clipboard?.write) {
      const blob = Promise.resolve(text).then(t => new Blob([t], { type: 'text/plain' }))
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
    } else {
      await navigator.clipboard.writeText(await text)
    }
    return true
  } catch {
    return false
  }
}
