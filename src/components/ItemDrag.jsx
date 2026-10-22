import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { LockIcon } from './Icons.jsx'

// Drag-and-drop pieces for the receipt editor's item list (AddReceipt).
// The list is a set of containers, "ungrouped" plus one per meal; items sort
// within a container and move between them.

export const UNGROUPED = 'ungrouped'
const CONTAINER_PREFIX = 'container:'
export const containerDropId = id => CONTAINER_PREFIX + id
export const containerFromDropId = id => String(id).startsWith(CONTAINER_PREFIX) ? String(id).slice(CONTAINER_PREFIX.length) : null

// One item row. children gets the handle's props: only the ⠿ handle starts a
// drag, so the inputs keep working normally (and scrolling on phones).
export function SortableRow({ id, disabled, children }) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id, disabled })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`relative ${isDragging ? 'z-0' : ''}`}
    >
      {/* While dragging, the row stays as a soft placeholder where it'll land */}
      <div className={isDragging ? 'opacity-0' : ''}>
        {children({ ref: setActivatorNodeRef, ...attributes, ...listeners })}
      </div>
      {isDragging && <div className="absolute inset-0 rounded-lg border-2 border-dashed border-accent-300 bg-accent-50/60" />}
    </div>
  )
}

export function DragHandle({ handleProps, disabled }) {
  if (disabled) return <div className="w-7 shrink-0 -ml-1.5" />
  return (
    <button
      type="button"
      {...handleProps}
      aria-label="Drag to reorder"
      title="Drag to reorder or move to a meal"
      className="w-7 h-11 sm:h-10 shrink-0 -ml-1.5 flex items-center justify-center rounded-md text-gray-300 hover:text-gray-500 hover:bg-gray-100 active:text-gray-500 active:bg-gray-100 cursor-grab active:cursor-grabbing touch-none select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
    >
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <circle cx="5.5" cy="3.5" r="1.3" /><circle cx="10.5" cy="3.5" r="1.3" />
        <circle cx="5.5" cy="8" r="1.3" /><circle cx="10.5" cy="8" r="1.3" />
        <circle cx="5.5" cy="12.5" r="1.3" /><circle cx="10.5" cy="12.5" r="1.3" />
      </svg>
    </button>
  )
}

// A list (ungrouped or a meal) that items can be dropped into, even when empty
export function DropZone({ id, className, children }) {
  const { setNodeRef } = useDroppable({ id: containerDropId(id) })
  return <div ref={setNodeRef} className={className}>{children}</div>
}

// What follows the pointer while dragging: a solid, lifted copy of the row
export function ItemDragPreview({ item }) {
  return (
    <div className="flex gap-1.5 sm:gap-2 items-center bg-white rounded-lg shadow-xl shadow-gray-900/15 ring-1 ring-gray-200 px-1 py-1 scale-[1.02] cursor-grabbing">
      <div className="w-7 h-11 sm:h-10 shrink-0 -ml-1.5 flex items-center justify-center text-gray-500">
        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="5.5" cy="3.5" r="1.3" /><circle cx="10.5" cy="3.5" r="1.3" />
          <circle cx="5.5" cy="8" r="1.3" /><circle cx="10.5" cy="8" r="1.3" />
          <circle cx="5.5" cy="12.5" r="1.3" /><circle cx="10.5" cy="12.5" r="1.3" />
        </svg>
      </div>
      <div className="flex-1 min-w-0 h-11 sm:h-10 flex items-center border border-gray-300 rounded-lg px-3 text-sm text-gray-900"><span className="truncate">{item.name || 'Item'}</span></div>
      <div className="w-24 sm:w-28 shrink-0 h-11 sm:h-10 flex items-center gap-1 border border-gray-300 rounded-lg pl-3 pr-2 text-sm text-gray-900">
        <span className="text-gray-400">$</span>{item.price || '0.00'}
      </div>
      {/* Where the lock and ✕ buttons are in the row */}
      <div className="w-[4.375rem] sm:w-[4.5rem] shrink-0 flex items-center">
        {item.always_split && <LockIcon className="w-4 h-4 mx-2 text-accent-600" />}
      </div>
    </div>
  )
}
