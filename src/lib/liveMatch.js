// Matching live-update batches (lib/live.js) to what a page shows. No
// Supabase or browser here, so it's unit-tested.

// Does a batch touch this receipt? (Claims and "not mine"s are matched by
// item; a deleted row only carries its id, so any delete there counts.)
export function touchesReceipt(batch, receiptId, itemIds) {
  if (batch.all) return true
  return batch.events.some(({ table, type, row, old }) => {
    const r = type === 'DELETE' ? old : row
    switch (table) {
      case 'receipts': return r.id === receiptId
      case 'items': case 'meals': case 'checkins': case 'receipt_notices':
        return type === 'DELETE' ? true : r.receipt_id === receiptId
      case 'claims': case 'item_dismissals':
        return type === 'DELETE' ? true : itemIds.has(r.item_id)
      case 'group_members': return true
      default: return false
    }
  })
}

// Does a batch touch any of these tables?
export function touchesTables(batch, tables) {
  return batch.all || batch.events.some(e => tables.includes(e.table))
}
