import { useEffect, useState, useRef, useCallback } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  pointerWithin, rectIntersection, closestCenter, getFirstCollision, MeasuringStrategy,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useGroup } from '../lib/group.jsx'
import { receiptFromDb } from '../lib/db.js'
import { fetchGeminiKey } from './Settings.jsx'
import { useDialog } from '../lib/useDialog.jsx'
import { CATEGORIES, GEMINI_MODEL } from '../config.js'
import BackButton from '../components/BackButton.jsx'
import Select from '../components/Select.jsx'
import LoadError from '../components/LoadError.jsx'
import { PageLoading } from '../components/Loading.jsx'
import StableLabel from '../components/StableLabel.jsx'
import { CheckOrPlus, LockIcon, XIcon } from '../components/Icons.jsx'
import { money, FIELD, FIELD_ERROR, toggleChip, choiceChip } from '../lib/ui.js'
import { parseAmount, amountOrZero, toggleSign } from '../lib/amount.js'
import { useGoBack, canGoBack } from '../lib/useGoBack.js'
import { useUnsavedChanges, leaveWithoutPrompt } from '../lib/unsaved.jsx'
import { invalidateSearch } from '../lib/search.jsx'
import { merge3, toSaveData, fromDb } from '../lib/receiptMerge.js'
import { useEditors } from '../lib/editLock.js'
import { onLive } from '../lib/live.js'
import MergeConflicts from '../components/MergeConflicts.jsx'
import { UNGROUPED, containerFromDropId, SortableRow, DragHandle, DropZone, ItemDragPreview } from '../components/ItemDrag.jsx'

function newItem(dbId = null) {
  return { id: crypto.randomUUID(), dbId, name: '', price: '', always_split: false, meal_local_id: null }
}

// Today as YYYY-MM-DD in the device's time zone (not UTC)
function localToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const isBlankItem = item => !item.name.trim() && item.price === ''
const containerOf = item => item.meal_local_id || UNGROUPED

// On blur, a typed amount shows as money ("5" -> "5.00"); blank or
// unreadable text is left as typed, so the error still points at it
function formatAmount(value) {
  const n = parseAmount(value)
  return String(value).trim() && !isNaN(n) ? n.toFixed(2) : value
}

// Every list (ungrouped and each meal) ends with one empty row to type into.
// Lists show their items in array order, so moving the empty rows to the end
// of the array puts each one last in its own list.
function withBlankRows(items, mealIds) {
  const next = [...items]
  for (const meal of [null, ...mealIds]) {
    if (!next.some(i => (i.meal_local_id || null) === meal && isBlankItem(i))) next.push({ ...newItem(), meal_local_id: meal })
  }
  return [...next.filter(i => !isBlankItem(i)), ...next.filter(isBlankItem)]
}

function newMeal(dbId = null) {
  return { local_id: crypto.randomUUID(), dbId, name: '', fee: '' }
}

export default function AddReceipt() {
  const { receiptId } = useParams()
  const isEditing = !!receiptId
  const navigate = useNavigate()
  const goBack = useGoBack()
  // Editing, opened from the receipt page: that page is the previous screen
  const fromReceipt = !!useLocation().state?.fromReceipt
  const [searchParams] = useSearchParams()

  const [storeName, setStoreName] = useState('')
  const [paidBy, setPaidBy] = useState('')
  const { group, memberships, switchGroup, members, myName, myMember, coreNames: coreRoommates, nameOf, ensureMemberIds } = useGroup()
  const knownNames = members.filter(m => m.active).map(m => m.displayName)
  // A payer the form put on the receipt (not picked by hand): switching to
  // another payer takes them off again
  const autoAddedPayer = useRef(null)
  const [lineItems, setLineItems] = useState([newItem()])
  const [meals, setMeals] = useState([])
  // Editing: the receipt as opened (what your changes are compared with when
  // someone else saved meanwhile) and its version
  const baseRef = useRef(null)
  const versionRef = useRef(null)
  const [conflictAsk, setConflictAsk] = useState(null)
  // Someone else saved this receipt while it's open here
  const [theyChanged, setTheyChanged] = useState(false)
  // Opened while someone else was editing it: view-only, unless "Edit anyway"
  const [editAnyway, setEditAnyway] = useState(false)
  const [category, setCategory] = useState('Groceries')
  const [receiptDate, setReceiptDate] = useState(() => {
    if (!receiptId) return searchParams.get('date') || localToday()
    return ''
  })
  const [receiptMembers, setReceiptMembers] = useState([])
  const [memberInput, setMemberInput] = useState('')
  const [tip, setTip] = useState('')
  const [tax, setTax] = useState('')
  const [fees, setFees] = useState('')
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [errors, setErrors] = useState({})
  const [isDirty, setIsDirty] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  // Editing: no form until the receipt is in (a blank one could be saved over it)
  const [loaded, setLoaded] = useState(!isEditing)
  const scanInputRef = useRef(null)
  const [activeDragId, setActiveDragId] = useState(null)
  const itemsBeforeDrag = useRef(null)
  const lastOverId = useRef(null)
  const lineItemsRef = useRef(lineItems)
  lineItemsRef.current = lineItems
  const mealIdsRef = useRef([])
  mealIdsRef.current = meals.map(m => m.local_id)
  const loadComplete = useRef(false)
  const formRef = useRef(null)
  // Picked by hand: a scan doesn't change it
  const categoryPicked = useRef(false)
  const { confirm, showAlert, DialogUI } = useDialog()
  const unsavedDialog = useUnsavedChanges(isDirty, "Your changes to this receipt aren't saved. Leave without saving them?")

  useEffect(() => {
    async function load() {
      const core = coreRoommates

      if (isEditing) {
        setLoadError(false)
        const { data: row, error: rowError } = await supabase
          .from('receipts').select('*').eq('id', receiptId).single()
        // A blank form here would overwrite the receipt on save
        if (rowError) { setLoadError(true); return }
        if (row && row.group_id !== group.id) {
          if (memberships.some(m => m.group_id === row.group_id)) switchGroup(row.group_id)
          else setLoadError(true)
          return
        }
        versionRef.current = row.version
        const receipt = row && receiptFromDb(row, nameOf)
        if (receipt) {
          setStoreName(receipt.store_name)
          setPaidBy(receipt.paid_by)
          setCategory(receipt.category || 'Groceries')
          setTip(receipt.tip ? String(receipt.tip) : '')
          setTax(receipt.tax ? String(receipt.tax) : '')
          setFees(receipt.fees ? String(receipt.fees) : '')
          if (receipt.receipt_date) setReceiptDate(receipt.receipt_date)
          setReceiptMembers(receipt.members || core)
        }

        const [{ data: existingItems, error: itemsError }, { data: existingMeals, error: mealsError }] = await Promise.all([
          supabase.from('items').select('*').eq('receipt_id', receiptId).is('deleted_at', null)
            .order('position', { ascending: true, nullsFirst: false }).order('created_at'),
          supabase.from('meals').select('*').eq('receipt_id', receiptId).is('deleted_at', null).order('created_at').order('id'),
        ])
        if (itemsError || mealsError) { setLoadError(true); return }

        const loadedMeals = (existingMeals || []).map(m => ({
          local_id: crypto.randomUUID(),
          dbId: m.id,
          name: m.name,
          fee: m.fee ? String(m.fee) : '',
        }))
        setMeals(loadedMeals)
        baseRef.current = fromDb(row, existingItems || [], existingMeals || [])
        setTheyChanged(false)

        const dbIdToLocalId = new Map(loadedMeals.map(m => [m.dbId, m.local_id]))

        const loaded = (existingItems || []).map(item => ({
          id: crypto.randomUUID(),
          dbId: item.id,
          name: item.name,
          price: String(item.price),
          always_split: item.always_split || false,
          meal_local_id: item.meal_id ? (dbIdToLocalId.get(item.meal_id) || null) : null,
        }))
        setLineItems(withBlankRows(loaded, loadedMeals.map(m => m.local_id)))
      } else {
        if (myName) setPaidBy(myName)
        // Default: the group's regular (non-guest) people, plus me
        setReceiptMembers([...new Set([...core, ...(myName ? [myName] : [])])])
      }
      loadComplete.current = true
      setLoaded(true)
    }
    load()
  }, [receiptId, isEditing, group.id, loadAttempt])

  // Who else has this receipt open in the editor (lib/editLock.js). The
  // first to open it edits; anyone after sees it view-only until they're
  // done, or taps "Edit anyway" (then saving combines both edits). Already
  // typing when you find out (the list arrives a moment after opening):
  // you keep editing.
  const editors = useEditors(isEditing ? receiptId : null, { editing: isEditing && !!myMember, memberId: myMember?.id })
  const myIndex = editors.findIndex(e => e.mine)
  const lockedBy = isEditing && !editAnyway && !isDirty && myIndex > 0 ? editors[0] : null
  const lastOtherEditor = useRef(null)
  const otherNow = editors.find(e => !e.mine)
  if (otherNow) lastOtherEditor.current = otherNow

  // The lock just freed up (they saved or left): load the receipt again, so
  // you start from their changes
  const wasLocked = useRef(false)
  useEffect(() => {
    if (lockedBy) { wasLocked.current = true; return }
    if (wasLocked.current) { wasLocked.current = false; setLoadAttempt(n => n + 1) }
  }, [!!lockedBy])

  // Someone else saved it while it's open here (your save combines both)
  const savingRef = useRef(false)
  savingRef.current = saving
  useEffect(() => {
    if (!isEditing) return
    return onLive(batch => {
      const bumped = batch.events.some(e => e.table === 'receipts' && e.row?.id === receiptId && versionRef.current != null && e.row.version > versionRef.current)
      if (bumped && !savingRef.current) setTheyChanged(true)
    })
  }, [isEditing, receiptId])

  function markDirty() {
    if (loadComplete.current) setIsDirty(true)
  }

  function toTitleCase(str) {
    // Only convert if the string is mostly uppercase (e.g. "SOURDOUGH BREAD")
    const letters = (str.match(/[a-zA-Z]/g) || [])
    const upperCount = letters.filter(c => c === c.toUpperCase()).length
    if (letters.length < 3 || upperCount / letters.length < 0.7) return str
    return str.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
  }

  async function scanOneFile(file, apiKey) {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result.split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        // The key goes in a header, not the URL, so it isn't kept in logs or history
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: file.type, data: base64 } },
              { text: `Extract receipt data from this image and return ONLY valid JSON with this exact structure:
{
  "store_name": "string",
  "category": "Groceries" | "Dining" | "Transportation" | "Misc",
  "items": [{"name": "string", "price": number}],
  "tip": number,
  "tax": number,
  "fees": number
}
Rules:
- category: "Groceries" for supermarkets/grocery stores, "Dining" for restaurants/cafes/food delivery, "Transportation" for gas/rideshare/parking, "Misc" for everything else
- items: individual line items only — no subtotals, totals, or tax lines
- tip/tax/fees: 0 if not present, positive numbers if present
- PRICE COLUMN: if the receipt has multiple price columns (e.g. "Price" and "You Pay", or "Regular" and "Member", or "Original" and "Sale", or "List" and "Final"), always use the FINAL/DISCOUNTED price the customer actually paid — i.e. "You Pay", "Member Price", "Sale Price", "Final", "Net" — NOT the original/regular/list price
- item names: use normal title case (e.g. "Sourdough Bread"), not ALL CAPS even if the receipt shows all caps
- Return ONLY the JSON object, no markdown, no extra text` },
            ],
          }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      }
    )

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error?.message || `API error ${res.status}`)
    }

    const data = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error('No response from Gemini')
    return JSON.parse(text)
  }

  async function scanReceipts(files) {
    setScanning(true)
    try {
      const apiKey = await fetchGeminiKey()
      if (!apiKey) {
        await showAlert('Add a Gemini API key in Settings to use receipt scanning.', { title: 'No API key set' })
        return
      }
      // One unreadable photo doesn't sink the others
      const settled = await Promise.allSettled(Array.from(files).map(f => scanOneFile(f, apiKey)))
      const results = settled.filter(r => r.status === 'fulfilled').map(r => r.value)
      const failed = settled.filter(r => r.status === 'rejected')
      if (!results.length) throw failed[0].reason

      // Scanning adds to the receipt; it never replaces what's there. Fields
      // are only filled if they're still empty now (the user may have typed
      // in them while the scan ran).
      const hasItems = lineItems.some(i => !isBlankItem(i))
      const fillIfEmpty = (current, set, value) => { if (value) set(cur => (String(cur).trim() ? cur : value)) }

      // Photos of the same receipt share a store name
      const groups = new Map()
      for (const result of results) {
        const storeKey = String(result.store_name || '').toLowerCase().trim() || '__unknown__'
        if (!groups.has(storeKey)) groups.set(storeKey, [])
        groups.get(storeKey).push(result)
      }

      // Store name + category from the first result that has them
      const firstStore = results.find(r => r.store_name)
      const firstCat = results.find(r => r.category)
      if (firstStore?.store_name) { fillIfEmpty(storeName, setStoreName, toTitleCase(firstStore.store_name)); setErrors(v => ({ ...v, storeName: undefined })) }
      if (firstCat?.category && ['Groceries', 'Dining', 'Transportation', 'Misc'].includes(firstCat.category) && !hasItems && !categoryPicked.current) {
        setCategory(firstCat.category)
      }

      // Tip/tax/fees: photos of one receipt each show the same totals, so take
      // the largest per receipt (not the sum), then add up different receipts
      const extra = field => [...groups.values()].reduce((sum, rs) => sum + Math.max(0, ...rs.map(r => Number(r[field]) || 0)), 0)
      const [totalTip, totalTax, totalFees] = [extra('tip'), extra('tax'), extra('fees')]
      if (totalTip > 0) fillIfEmpty(tip, setTip, totalTip.toFixed(2))
      if (totalTax > 0) fillIfEmpty(tax, setTax, totalTax.toFixed(2))
      if (totalFees > 0) fillIfEmpty(fees, setFees, totalFees.toFixed(2))

      // Items: an item listed twice on one photo is two items. Across photos
      // of the same receipt (overlapping shots), keep the most times any one
      // photo shows it, so overlaps aren't counted twice.
      const merged = []
      for (const groupResults of groups.values()) {
        const keep = new Map() // key -> { count, name, price }
        for (const result of groupResults) {
          const counts = new Map()
          for (const item of (result.items || [])) {
            const name = String(item.name || '').trim()
            const price = Number(item.price)
            if (!name || !price) continue
            const key = `${name.toLowerCase().replace(/\s+/g, ' ')}|${price.toFixed(2)}`
            counts.set(key, (counts.get(key) || 0) + 1)
            if (!keep.has(key)) keep.set(key, { count: 0, name, price })
          }
          for (const [key, n] of counts) keep.get(key).count = Math.max(keep.get(key).count, n)
        }
        for (const { count, name, price } of keep.values()) {
          for (let n = 0; n < count; n++) {
            merged.push({ ...newItem(), name: toTitleCase(name), price: price.toFixed(2) })
          }
        }
      }

      // Remove pairs that cancel out (e.g. "Bag $0.25" + "Bag Exempt -$0.25")
      const cancelledIds = new Set()
      for (const neg of merged.filter(i => Number(i.price) < 0)) {
        const absVal = Math.abs(Number(neg.price))
        const candidates = merged.filter(
          pos => !cancelledIds.has(pos.id) && pos.id !== neg.id && Math.abs(Number(pos.price) - absVal) < 0.001
        )
        if (!candidates.length) continue
        // Prefer the candidate whose name shares the most words with the negative item's name
        const negWords = neg.name.toLowerCase().split(/\s+/)
        const match = candidates.reduce((best, pos) => {
          const posWords = pos.name.toLowerCase().split(/\s+/)
          const overlap = negWords.filter(w => posWords.includes(w)).length
          const bestWords = best.name.toLowerCase().split(/\s+/)
          const bestOverlap = negWords.filter(w => bestWords.includes(w)).length
          return overlap > bestOverlap ? pos : best
        })
        cancelledIds.add(neg.id)
        cancelledIds.add(match.id)
      }
      const finalItems = merged.filter(i => !cancelledIds.has(i.id))

      if (finalItems.length > 0) {
        setLineItems(prev => withBlankRows([...prev.filter(i => !isBlankItem(i)), ...finalItems], mealIdsRef.current))
        setErrors(v => ({ ...v, items: undefined }))
        markDirty()
      } else {
        await showAlert('No items could be extracted from this image. Try a clearer photo or enter items manually.', { title: 'No items found' })
      }
      if (failed.length) {
        await showAlert(`${failed.length} of ${settled.length} photos couldn't be read (${failed[0].reason?.message || 'unknown error'}). The rest were added; try those again or enter them by hand.`, { title: 'Some photos failed' })
      }
    } catch (err) {
      await showAlert(err?.message || String(err) || 'Unknown error', { title: 'Scan failed' })
    } finally {
      setScanning(false)
    }
  }

  // Unsaved changes: asks however you leave (see useUnsavedChanges)
  function handleBack() {
    leave()
  }

  // Back to where the form was opened from: the receipt being edited, or
  // wherever "New receipt" was tapped (Home if opened straight from a link)
  function leave() {
    if (!isEditing) goBack('/')
    else if (fromReceipt) goBack(`/receipt/${receiptId}`)
    else navigate(`/receipt/${receiptId}`, { replace: true })
  }

  // Typing in a list's empty row makes it a real item, and a new empty row
  // appears under it
  function updateItem(itemId, field, value) {
    markDirty()
    setLineItems(prev => {
      const next = prev.map(item => item.id === itemId ? { ...item, [field]: value } : item)
      const item = next.find(i => i.id === itemId)
      const container = item?.meal_local_id || null
      if (next.some(i => (i.meal_local_id || null) === container && isBlankItem(i))) return next
      return [...next, { ...newItem(), meal_local_id: container }]
    })
  }

  // Not an edit (same amount), so it doesn't mark the form changed
  function formatItemPrice(itemId) {
    setLineItems(prev => prev.map(item => item.id === itemId ? { ...item, price: formatAmount(item.price) } : item))
  }

  function removeItem(itemId) {
    markDirty()
    setLineItems(prev => withBlankRows(prev.filter(i => i.id !== itemId), mealIdsRef.current))
  }

  function addMeal() {
    markDirty()
    const meal = newMeal()
    setMeals(prev => [...prev, meal])
    setLineItems(prev => [...prev, { ...newItem(), meal_local_id: meal.local_id }])
  }

  function updateMeal(localId, field, value) {
    markDirty()
    setMeals(prev => prev.map(m => m.local_id === localId ? { ...m, [field]: value } : m))
    if (field === 'name') setErrors(v => ({ ...v, [`meal-${localId}`]: undefined }))
  }

  // The meal's items move back to the main list; its empty row goes away
  function removeMeal(localId) {
    markDirty()
    setLineItems(prev => withBlankRows(
      prev.filter(i => !(i.meal_local_id === localId && isBlankItem(i)))
        .map(i => i.meal_local_id === localId ? { ...i, meal_local_id: null } : i),
      mealIdsRef.current.filter(id => id !== localId),
    ))
    setMeals(prev => prev.filter(m => m.local_id !== localId))
  }

  // ── Drag and drop ──────────────────────────────────────────
  // Pointer covers mouse, pen and touch (the handle has touch-action: none);
  // a few pixels of movement before a drag starts keeps taps as taps.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function findContainer(id) {
    const fromDrop = containerFromDropId(id)
    if (fromDrop) return fromDrop
    const item = lineItemsRef.current.find(i => i.id === id)
    return item ? containerOf(item) : null
  }

  // The pointer picks the list (ungrouped or a meal); within it, the row
  // whose center is nearest the dragged row's center is the target. So rows
  // swap once you're past a neighbor's middle, not the moment you touch it.
  const collisionDetection = useCallback(args => {
    const hits = pointerWithin(args)
    const firstId = getFirstCollision(hits.length ? hits : rectIntersection(args), 'id')
    if (firstId == null) return lastOverId.current ? [{ id: lastOverId.current }] : []
    const containerHit = hits.map(h => containerFromDropId(h.id)).find(Boolean)
    const container = containerHit ?? findContainer(firstId)
    const ids = new Set(lineItemsRef.current
      .filter(i => containerOf(i) === container && !isBlankItem(i))
      .map(i => i.id))
    let overId = containerHit ? `container:${container}` : firstId
    if (ids.size) {
      overId = closestCenter({ ...args, droppableContainers: args.droppableContainers.filter(c => ids.has(c.id)) })[0]?.id ?? overId
    }
    lastOverId.current = overId
    return [{ id: overId }]
  }, [])

  function handleDragStart({ active }) {
    itemsBeforeDrag.current = lineItems
    setActiveDragId(active.id)
    document.body.style.cursor = 'grabbing'
    navigator.vibrate?.(8)
  }

  // Moving into another list happens live, so the rows there make room
  function handleDragOver({ active, over, activatorEvent, delta }) {
    if (!over) return
    const from = findContainer(active.id)
    const to = findContainer(over.id)
    if (!from || !to || from === to) return
    setLineItems(items => {
      const moving = items.find(i => i.id === active.id)
      const rest = items.filter(i => i.id !== active.id)
      const moved = { ...moving, meal_local_id: to === UNGROUPED ? null : to }
      let at
      if (containerFromDropId(over.id)) {
        const blank = rest.findIndex(i => containerOf(i) === to && isBlankItem(i))
        const last = rest.findLastIndex(i => containerOf(i) === to)
        at = blank !== -1 ? blank : last === -1 ? rest.length : last + 1
      } else {
        // Above or below the row under the pointer, by which half it's in
        const overIndex = rest.findIndex(i => i.id === over.id)
        const startY = activatorEvent?.clientY ?? activatorEvent?.touches?.[0]?.clientY
        const pointerY = startY == null ? null : startY + delta.y
        const below = pointerY != null && pointerY > over.rect.top + over.rect.height / 2
        at = overIndex + (below ? 1 : 0)
      }
      rest.splice(at, 0, moved)
      return rest
    })
  }

  function endDrag() {
    setActiveDragId(null)
    lastOverId.current = null
    document.body.style.cursor = ''
  }

  function handleDragEnd({ active, over }) {
    endDrag()
    const items = lineItemsRef.current
    let next = items
    if (over && !containerFromDropId(over.id) && active.id !== over.id && findContainer(active.id) === findContainer(over.id)) {
      next = arrayMove(items, items.findIndex(i => i.id === active.id), items.findIndex(i => i.id === over.id))
    }
    next = withBlankRows(next, mealIdsRef.current)
    const key = list => list.map(i => `${i.id}:${i.meal_local_id}`).join()
    if (key(next) !== key(itemsBeforeDrag.current || [])) markDirty()
    setLineItems(next)
  }

  function handleDragCancel() {
    endDrag()
    if (itemsBeforeDrag.current) setLineItems(itemsBeforeDrag.current)
  }

  // A typed name as the group shows it: "alex" or a bare first name becomes
  // that person ("Alex K."), so the same person isn't added twice
  function canonicalName(typed) {
    const lc = typed.trim().toLowerCase()
    const exact = members.find(m => m.displayName.toLowerCase() === lc)
    if (exact) return exact.displayName
    const byFirst = members.filter(m => m.active && m.first_name.trim().toLowerCase() === lc)
    return byFirst.length === 1 ? byFirst[0].displayName : typed.trim()
  }

  // receiptMembers plus whatever is typed in "Add someone…" (not added yet)
  function membersWithTyped() {
    const name = memberInput.trim() && canonicalName(memberInput)
    if (!name || receiptMembers.some(n => n.toLowerCase() === name.toLowerCase())) return receiptMembers
    return [...receiptMembers, name]
  }

  // The payer is put on the receipt; deselecting them afterwards means they
  // paid but had nothing (nobody waits on them to check in)
  function pickPayer(name) {
    markDirty()
    setErrors(v => ({ ...v, paidBy: undefined }))
    setPaidBy(name)
    setReceiptMembers(prev => {
      let next = prev
      if (autoAddedPayer.current && autoAddedPayer.current !== name) {
        next = next.filter(m => m !== autoAddedPayer.current)
      }
      autoAddedPayer.current = null
      if (name && !next.includes(name)) {
        next = [...next, name]
        autoAddedPayer.current = name
      }
      return next
    })
  }

  function addTypedMember() {
    const next = membersWithTyped()
    if (next !== receiptMembers) { markDirty(); setReceiptMembers(next) }
    setMemberInput('')
  }

  function filledItems() {
    return lineItems.filter(item => item.name.trim() || item.price !== '')
  }

  // Enter moves to the next field instead of saving the receipt (on a phone,
  // "Go" after an item would otherwise save it half-typed). Save is the
  // button; Ctrl/⌘+Enter still saves from the keyboard.
  function handleFormKeyDown(e) {
    if (e.key !== 'Enter' || e.defaultPrevented || e.target.tagName !== 'INPUT') return
    if (e.metaKey || e.ctrlKey) return
    e.preventDefault()
    const fields = [...e.currentTarget.querySelectorAll('input:not([type=checkbox]):not([type=hidden]):not([disabled]), select, textarea')]
      .filter(el => el.offsetParent)
    const next = fields[fields.indexOf(e.target) + 1]
    if (next) next.focus(); else e.target.blur()
  }

  // Tip, tax and fees: blank, or an amount that isn't negative
  const validExtra = value => !String(value).trim() || parseAmount(value) >= 0

  function validate() {
    const errs = {}
    if (!receiptDate) errs.receiptDate = 'Pick the date of the receipt.'
    if (!storeName.trim()) errs.storeName = 'Add the store name.'
    if (!paidBy.trim()) errs.paidBy = 'Pick who paid.'
    if (filledItems().length === 0) errs.items = 'Add at least one item.'
    filledItems().forEach(item => {
      if (!item.name.trim()) errs[`name-${item.id}`] = 'Required'
      const p = parseAmount(item.price)
      if (isNaN(p)) errs[`price-${item.id}`] = 'Invalid'
    })
    meals.forEach(meal => {
      if (!meal.name.trim()) errs[`meal-${meal.local_id}`] = 'Name this meal'
      if (!validExtra(meal.fee)) errs[`mealfee-${meal.local_id}`] = 'Invalid'
    })
    if (!validExtra(tip)) errs.tip = 'Invalid'
    if (!validExtra(tax)) errs.tax = 'Invalid'
    if (!validExtra(fees)) errs.fees = 'Invalid'
    return errs
  }

  // The form as a receipt for save_receipt / merging (lib/receiptMerge.js).
  // Meals and items keep their database ids; new ones are known by their
  // form ids.
  function formAsReceipt(paidById, memberIds) {
    const namedMeals = meals.filter(m => m.name.trim())
    return {
      fields: {
        store_name: storeName.trim(), paid_by_member: paidById, category,
        tip: amountOrZero(tip), tax: amountOrZero(tax), fees: amountOrZero(fees), receipt_date: receiptDate,
      },
      member_ids: memberIds,
      meals: namedMeals.map(m => ({ id: m.dbId || null, key: m.local_id, name: m.name.trim(), fee: amountOrZero(m.fee) })),
      items: filledItems().map(item => {
        const meal = namedMeals.find(m => m.local_id === item.meal_local_id)
        return {
          id: item.dbId || null, key: item.id, name: item.name.trim(), price: parseAmount(item.price), always_split: item.always_split,
          meal: meal?.dbId || null, meal_key: meal && !meal.dbId ? meal.local_id : null,
        }
      }),
    }
  }

  // The receipt as it is now in the database (someone saved meanwhile)
  async function loadCurrent() {
    const [{ data: row, error }, { data: items, error: itemsError }, { data: mealRows, error: mealsError }] = await Promise.all([
      supabase.from('receipts').select('*').eq('id', receiptId).single(),
      supabase.from('items').select('*').eq('receipt_id', receiptId).is('deleted_at', null),
      supabase.from('meals').select('*').eq('receipt_id', receiptId).is('deleted_at', null),
    ])
    if (error || itemsError || mealsError) throw new Error((error || itemsError || mealsError).message)
    return { receipt: fromDb(row, items || [], mealRows || []), version: row.version, deleted: !!row.deleted_at }
  }

  // Who else is (or was just) editing, for "Alex saved changes…"
  const otherEditorName = () => {
    const other = editors.find(e => !e.mine && e.member_id !== myMember?.id) || lastOtherEditor.current
    return other ? nameOf(other.member_id) : 'Someone'
  }

  async function handleSave(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      // The first problem may be far up the page: bring it into view
      requestAnimationFrame(() => {
        // (FIELD_ERROR is the "!border-red-400" class)
        const field = formRef.current?.querySelector('.\\!border-red-400, .border-red-400, .placeholder-red-400, p.text-red-500')
        field?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        if (field?.matches('input')) field.focus({ preventScroll: true })
      })
      return
    }

    setSaving(true)

    // Names -> people in the group (new names become guests). A name still
    // typed in "Add someone…" counts as added.
    const people = membersWithTyped()
    if (people !== receiptMembers) { setReceiptMembers(people); setMemberInput('') }
    let paidById, memberIds
    try {
      ;[paidById, ...memberIds] = await ensureMemberIds([paidBy, ...people])
      memberIds = [...new Set(memberIds)]
    } catch (err) {
      await showAlert(err.message, { title: 'Error saving people' }); setSaving(false); return
    }

    // One database call: it all saves, or (on an error) none of it does.
    // Editing: it only saves over the version opened here. If someone saved
    // in between, their changes and these are combined (asking about
    // anything you both changed) and saved over theirs.
    const mine = formAsReceipt(paidById, memberIds)
    let toSave = mine
    let version = versionRef.current
    let choices = {}
    try {
      for (let attempt = 0; ; attempt++) {
        const { data: saved, error } = await supabase.rpc('save_receipt', {
          p_group: group.id, p_receipt: isEditing ? receiptId : null, p_version: isEditing ? version : null, p_data: toSaveData(toSave),
        })
        if (!error) {
          invalidateSearch(group.id)
          leaveWithoutPrompt()
          // A new receipt takes the form's place, so Back from it doesn't reopen the form
          if (isEditing) leave()
          else navigate(`/receipt/${saved.id}`, { replace: true })
          return
        }
        if (error.code === 'RCPT2') {
          await showAlert('Someone deleted this receipt while you were editing it, so your changes weren\'t saved. To bring it back, open it and tap Restore.', { title: 'This receipt was deleted' })
          setSaving(false)
          return
        }
        if (error.code !== 'RCPT1' || !isEditing || attempt >= 4) throw new Error(error.message)

        const current = await loadCurrent()
        let merged = merge3(baseRef.current, mine, current.receipt, choices)
        const open = merged.conflicts.filter(c => !choices[c.key])
        if (open.length) {
          const picked = await askConflicts(open, current.receipt)
          if (!picked) { setSaving(false); return }
          choices = { ...choices, ...picked }
          merged = merge3(baseRef.current, mine, current.receipt, choices)
        }
        toSave = merged.result
        version = current.version
      }
    } catch (err) {
      await showAlert(`${err.message}. Nothing was saved; try again.`, { title: 'Error saving receipt' })
      setSaving(false)
    }
  }

  // Ask about edits that collide; resolves with the choices, or null
  function askConflicts(conflicts, theirs) {
    return new Promise(resolve => setConflictAsk({ conflicts, theirs, resolve }))
  }

  async function handleDelete() {
    if (!await confirm('It will be hidden for everyone, and the change is recorded in its history. To bring it back, open this receipt\'s link again and tap Restore.', {
      title: 'Delete receipt?',
      confirmLabel: 'Delete',
      danger: true,
    })) return
    const { error } = await supabase.from('receipts').update({ deleted_at: new Date().toISOString() }).eq('id', receiptId)
    if (error) { await showAlert(error.message, { title: 'Could not delete' }); return }
    // Skip the deleted receipt's page too: back to the screen before it
    invalidateSearch(group.id)
    leaveWithoutPrompt()
    if (fromReceipt && canGoBack(2)) navigate(-2)
    else navigate('/receipts', { replace: true })
  }

  const ungroupedItems = lineItems.filter(i => !i.meal_local_id)
  const activeDragItem = activeDragId ? lineItems.find(i => i.id === activeDragId) : null
  const activeContainer = activeDragItem ? containerOf(activeDragItem) : null

  function renderItemRow(item) {
    const canDrag = !isBlankItem(item)
    return (
      <SortableRow key={item.id} id={item.id} disabled={!canDrag}>
        {handleProps => (
      <div className="flex gap-1.5 sm:gap-2 items-start">
        <DragHandle handleProps={handleProps} disabled={!canDrag} />
        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={item.name}
            enterKeyHint="next"
            autoComplete="off"
            onChange={e => { updateItem(item.id, 'name', e.target.value); setErrors(v => ({ ...v, [`name-${item.id}`]: undefined })) }}
            placeholder="Item name"
            className={`${FIELD} ${errors[`name-${item.id}`] ? FIELD_ERROR : ''}`}
          />
        </div>
        <div className="w-24 sm:w-28 shrink-0">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 leading-none text-gray-400 text-sm">$</span>
            <input
              type="text"
              inputMode="decimal"
              enterKeyHint="next"
              value={item.price}
              onChange={e => { updateItem(item.id, 'price', e.target.value); setErrors(v => ({ ...v, [`price-${item.id}`]: undefined })) }}
              onBlur={() => formatItemPrice(item.id)}
              placeholder="0.00"
              className={`${FIELD} pl-6 pr-9 sm:pr-2 ${errors[`price-${item.id}`] ? FIELD_ERROR : ''}`}
            />
            {/* Phones: the number keypad has no minus key, so this makes a price
                negative (a discount). Keeps the keyboard open (no focus change). */}
            <button
              type="button"
              tabIndex={-1}
              onPointerDown={e => e.preventDefault()}
              onClick={() => { updateItem(item.id, 'price', toggleSign(item.price)); setErrors(v => ({ ...v, [`price-${item.id}`]: undefined })) }}
              aria-label="Make negative (discount)"
              className="sm:hidden absolute right-0.5 top-1/2 -translate-y-1/2 w-8 h-9 flex items-center justify-center rounded-md text-gray-400 active:bg-gray-100 text-sm"
            >
              ±
            </button>
          </div>
        </div>
        {/* An icon, not 🔒/🔓: emoji ignore text color, so every row showed
            the same full-color padlock whether it was on or off */}
        <button
          type="button"
          tabIndex={-1}
          onClick={() => updateItem(item.id, 'always_split', !item.always_split)}
          title={item.always_split ? 'Split with everyone who checks in — click to unlock' : 'Click to split with everyone who checks in'}
          className={`w-8 h-11 sm:h-10 shrink-0 flex items-center justify-center rounded-md transition active:bg-gray-100 ${item.always_split ? 'text-accent-600' : 'text-gray-300 hover:text-gray-400'}`}
          aria-label="Split with everyone who checks in"
          aria-pressed={item.always_split}
        >
          <LockIcon locked={item.always_split} />
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => removeItem(item.id)}
          className="w-8 h-11 sm:h-10 shrink-0 flex items-center justify-center rounded-md text-gray-400 hover:text-red-500 active:bg-gray-100 active:text-red-500 transition"
          aria-label="Remove item"
        >
          <XIcon />
        </button>
      </div>
        )}
      </SortableRow>
    )
  }

  if (loadError) return <LoadError onRetry={() => setLoadAttempt(n => n + 1)} />
  if (!loaded) return <PageLoading />

  return (
    <>
    {DialogUI}
    {unsavedDialog}
    <div className="max-w-xl mx-auto p-4 py-8">
      <BackButton onClick={handleBack} className="mb-2" />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {isEditing ? 'Edit Receipt' : 'Add Receipt'}
        </h1>
        <button
          type="button"
          onClick={() => scanInputRef.current?.click()}
          disabled={scanning || !!lockedBy}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-accent-200 text-accent-600 text-sm font-medium rounded-lg hover:bg-accent-50 transition disabled:opacity-50"
        >
          {scanning ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Scanning…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
              Scan receipt
            </>
          )}
        </button>
        <input
          ref={scanInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => { const fileArray = Array.from(e.target.files || []); e.target.value = ''; if (fileArray.length) scanReceipts(fileArray) }}
        />
      </div>

      {lockedBy ? (
        // Someone opened it first: view-only until they're done
        <div className="mb-5 bg-gray-900 text-white rounded-xl px-4 py-3 text-sm" role="status" data-edit-lock>
          <p className="font-medium">
            {lockedBy.member_id === myMember?.id ? "You're already editing this receipt in another tab or device." : `${nameOf(lockedBy.member_id)} is editing this receipt right now.`}
          </p>
          <p className="text-white/70 mt-0.5">You can edit it when they're done; this page will show their changes.</p>
          <button type="button" onClick={() => setEditAnyway(true)} className="mt-2 text-xs text-white/70 underline underline-offset-2 hover:text-white">
            Edit anyway (both changes will be combined)
          </button>
        </div>
      ) : theyChanged ? (
        <div className="mb-5 bg-accent-50 border border-accent-200 rounded-xl px-4 py-3 text-sm text-accent-800" role="status" data-they-changed>
          {otherEditorName()} changed this receipt while you were editing. When you save, your changes and theirs are combined (you'll be asked about anything you both changed).
        </div>
      ) : isEditing && (
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          Everyone's check-offs are kept. If you add items, everyone else checks in again (they're told what you added). Price changes are shown to whoever checked that item off. Taking someone off the receipt clears their check-offs.
        </div>
      )}

      {conflictAsk && (
        <MergeConflicts
          conflicts={conflictAsk.conflicts}
          who={otherEditorName()}
          nameOf={nameOf}
          mealName={ref => {
            const all = [...(conflictAsk.theirs?.meals || []), ...meals.map(m => ({ id: m.dbId, key: m.local_id, name: m.name }))]
            const id = ref.startsWith('new:') ? null : ref
            const key = ref.startsWith('new:') ? ref.slice(4) : null
            return all.find(m => (id && m.id === id) || (key && m.key === key))?.name || 'a meal'
          }}
          onDone={choices => { const { resolve } = conflictAsk; setConflictAsk(null); resolve(choices) }}
        />
      )}

      <form ref={formRef} onSubmit={handleSave} onKeyDown={handleFormKeyDown}>
      <fieldset disabled={!!lockedBy} className="space-y-5 min-w-0">
        {/* Date */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
          <input
            type="date"
            value={receiptDate}
            onChange={e => { markDirty(); setReceiptDate(e.target.value); setErrors(v => ({ ...v, receiptDate: undefined })) }}
            className={`${FIELD} ${errors.receiptDate ? FIELD_ERROR : ''}`}
          />
          {errors.receiptDate && <p className="text-xs text-red-500 mt-1">{errors.receiptDate}</p>}
        </div>

        {/* Members */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Who's on this receipt?</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {[...new Set([...coreRoommates, ...receiptMembers])].map(name => {
              const selected = receiptMembers.includes(name)
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    markDirty()
                    // Chosen by hand now: changing the payer leaves it alone
                    if (autoAddedPayer.current === name) autoAddedPayer.current = null
                    setReceiptMembers(prev =>
                      prev.includes(name) ? prev.filter(m => m !== name) : [...prev, name]
                    )
                  }}
                  aria-pressed={selected}
                  // Color alone didn't say which is which: on = filled with ✓,
                  // off = white with + (same width either way, so nothing jumps)
                  className={toggleChip(selected)}
                >
                  <CheckOrPlus on={selected} />
                  {name}
                </button>
              )
            })}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={memberInput}
              onChange={e => setMemberInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addTypedMember()
                }
              }}
              placeholder="Add someone…"
              autoCapitalize="words"
              autoComplete="off"
              enterKeyHint="done"
              className={`${FIELD} flex-1 min-w-0`}
            />
            <button
              type="button"
              onClick={addTypedMember}
              className="h-11 sm:h-10 px-4 shrink-0 text-sm font-medium border border-gray-300 rounded-lg bg-white hover:bg-gray-50 active:bg-gray-100 transition text-gray-600"
            >
              Add
            </button>
          </div>
        </div>

        {/* Store name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Store name</label>
          <input
            type="text"
            value={storeName}
            onChange={e => { markDirty(); setStoreName(e.target.value); setErrors(v => ({ ...v, storeName: undefined })) }}
            placeholder="e.g. Costco"
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="next"
            className={`${FIELD} ${errors.storeName ? FIELD_ERROR : ''}`}
            autoFocus={!isEditing && window.matchMedia('(min-width: 640px)').matches}
          />
          {errors.storeName && <p className="text-xs text-red-500 mt-1">{errors.storeName}</p>}
        </div>

        {/* Category */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
          <div className="flex gap-2 flex-wrap">
            {CATEGORIES.map(({ label }) => (
              <button
                key={label}
                type="button"
                onClick={() => { markDirty(); categoryPicked.current = true; setCategory(label) }}
                aria-pressed={category === label}
                className={choiceChip(category === label)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Paid by */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Paid by</label>
          {/* Only people on the receipt or in the group, so a typo can't make
              up a new person. Someone new: "Add someone…" above first. */}
          <Select
            value={paidBy}
            onChange={pickPayer}
            placeholder="Who paid?"
            ariaLabel="Paid by"
            invalid={!!errors.paidBy}
            options={[...new Set([...receiptMembers, ...knownNames, ...(paidBy ? [paidBy] : [])])].map(name => ({ value: name, label: name }))}
          />
          {errors.paidBy && <p className="text-xs text-red-500 mt-1">{errors.paidBy}</p>}
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">Items</label>
            <span className="flex items-center gap-1 text-xs text-gray-400"><LockIcon className="w-3.5 h-3.5" /> splits with everyone who checks in</span>
          </div>
          {errors.items && <p className="text-xs text-red-500 mb-2">{errors.items}</p>}

          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
          {/* Ungrouped items */}
          <SortableContext items={ungroupedItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
            <DropZone
              id={UNGROUPED}
              className={`space-y-2 min-h-[2.75rem] rounded-xl p-1 -m-1 transition-colors duration-150 ${activeContainer === UNGROUPED && meals.length > 0 ? 'bg-accent-50/70' : ''}`}
            >
              {ungroupedItems.map(item => renderItemRow(item))}
            </DropZone>
          </SortableContext>

          {/* Meal groups */}
          {meals.map(meal => {
            const mealItems = lineItems.filter(i => i.meal_local_id === meal.local_id)
            const isDragTarget = activeContainer === meal.local_id
            return (
              <div
                key={meal.local_id}
                className={`mt-3 border rounded-xl overflow-hidden transition-[box-shadow,border-color] duration-150 ${isDragTarget ? 'ring-2 ring-accent-300 border-accent-300' : 'border-gray-200'}`}
              >
                {/* Meal header */}
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
                  {/* The error shows in the field itself (red placeholder and
                      border): a message beside it pushed the row off a phone */}
                  <input
                    type="text"
                    value={meal.name}
                    onChange={e => updateMeal(meal.local_id, 'name', e.target.value)}
                    placeholder={errors[`meal-${meal.local_id}`] || 'Meal name (e.g. Dinner)'}
                    aria-label="Meal name"
                    aria-invalid={!!errors[`meal-${meal.local_id}`]}
                    autoComplete="off"
                    enterKeyHint="next"
                    className={`flex-1 min-w-0 h-9 rounded px-1 -mx-1 bg-transparent text-sm font-semibold text-gray-700 border outline-none focus:outline-none focus:bg-white focus:ring-2 focus:ring-accent-400 ${errors[`meal-${meal.local_id}`] ? 'border-red-400 placeholder-red-400' : 'border-transparent placeholder-gray-400'}`}
                  />
                  <div className="relative shrink-0 w-24">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 leading-none text-gray-400 text-xs">fee $</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      enterKeyHint="next"
                      value={meal.fee}
                      onChange={e => { updateMeal(meal.local_id, 'fee', e.target.value); setErrors(v => ({ ...v, [`mealfee-${meal.local_id}`]: undefined })) }}
                      onBlur={() => setMeals(prev => prev.map(m => m.local_id === meal.local_id ? { ...m, fee: formatAmount(m.fee) } : m))}
                      placeholder="0.00"
                      aria-label="Meal fee"
                      className={`w-full h-9 border rounded-md bg-white pl-9 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-accent-400 ${errors[`mealfee-${meal.local_id}`] ? 'border-red-400' : 'border-gray-200'}`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeMeal(meal.local_id)}
                    aria-label="Remove meal group"
                    title="Remove meal group"
                    className="w-8 h-8 -mr-1 shrink-0 flex items-center justify-center rounded-md text-gray-400 hover:text-red-500 active:bg-gray-200 active:text-red-500 transition"
                  >
                    <XIcon />
                  </button>
                </div>

                {/* Meal items */}
                <SortableContext items={mealItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                  <DropZone
                    id={meal.local_id}
                    className={`p-2 space-y-2 min-h-[3.25rem] transition-colors duration-150 ${isDragTarget ? 'bg-accent-50/70' : 'bg-white'}`}
                  >
                    {mealItems.map(item => renderItemRow(item))}
                  </DropZone>
                </SortableContext>
              </div>
            )
          })}

          <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
            {activeDragItem ? <ItemDragPreview item={activeDragItem} /> : null}
          </DragOverlay>
          </DndContext>

          {/* Add Meal Group button */}
          <button
            type="button"
            onClick={addMeal}
            className="mt-3 w-full py-2 border border-dashed border-gray-300 text-sm text-gray-500 rounded-xl hover:border-accent-300 hover:text-accent-500 transition"
          >
            + Add Meal Group
          </button>
        </div>

        {/* Tip, Tax & Fees */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Tip</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 leading-none text-gray-400 text-sm">$</span>
              <input
                type="text" inputMode="decimal"
                enterKeyHint="next"
                value={tip}
                onChange={e => { markDirty(); setTip(e.target.value); setErrors(v => ({ ...v, tip: undefined })) }}
                onBlur={() => setTip(formatAmount)}
                placeholder="0.00"
                className={`${FIELD} pl-6 pr-2 ${errors.tip ? FIELD_ERROR : ''}`}
              />
            </div>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Tax</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 leading-none text-gray-400 text-sm">$</span>
              <input
                type="text" inputMode="decimal"
                enterKeyHint="next"
                value={tax}
                onChange={e => { markDirty(); setTax(e.target.value); setErrors(v => ({ ...v, tax: undefined })) }}
                onBlur={() => setTax(formatAmount)}
                placeholder="0.00"
                className={`${FIELD} pl-6 pr-2 ${errors.tax ? FIELD_ERROR : ''}`}
              />
            </div>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Fees</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 leading-none text-gray-400 text-sm">$</span>
              <input
                type="text" inputMode="decimal"
                enterKeyHint="done"
                value={fees}
                onChange={e => { markDirty(); setFees(e.target.value); setErrors(v => ({ ...v, fees: undefined })) }}
                onBlur={() => setFees(formatAmount)}
                placeholder="0.00"
                className={`${FIELD} pl-6 pr-2 ${errors.fees ? FIELD_ERROR : ''}`}
              />
            </div>
          </div>
        </div>

        {/* Total preview */}
        {(() => {
          const itemsTotal = filledItems().reduce((s, i) => s + amountOrZero(i.price), 0)
          const tipAmt = amountOrZero(tip)
          const taxAmt = amountOrZero(tax)
          const feesAmt = amountOrZero(fees)
          const mealFeesAmt = meals.reduce((s, m) => s + amountOrZero(m.fee), 0)
          const grandTotal = itemsTotal + tipAmt + taxAmt + feesAmt + mealFeesAmt
          const hasExtras = tipAmt > 0 || taxAmt > 0 || feesAmt > 0 || mealFeesAmt > 0
          return (
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Receipt total</span>
                <span className="font-semibold text-gray-900 tabular-nums">{money(grandTotal)}</span>
              </div>
              {hasExtras && (
                <p className="text-xs text-gray-400 mt-0.5 text-right tabular-nums">
                  {money(itemsTotal)} items
                  {tipAmt > 0 && ` + ${money(tipAmt)} tip`}
                  {taxAmt > 0 && ` + ${money(taxAmt)} tax`}
                  {feesAmt > 0 && ` + ${money(feesAmt)} fees`}
                  {mealFeesAmt > 0 && ` + ${money(mealFeesAmt)} meal fees`}
                </p>
              )}
            </div>
          )
        })()}

        {Object.values(errors).some(Boolean) && (
          <p className="text-sm text-red-500 text-center -mb-2">Some fields need fixing. They're marked in red.</p>
        )}
        <button
          type="submit"
          // A scan still running would add items after the save
          disabled={saving || scanning}
          className="w-full py-3 bg-accent-600 text-white font-semibold rounded-xl hover:bg-accent-700 active:bg-accent-700 transition disabled:opacity-50"
        >
          <StableLabel
            current={saving ? 'Saving…' : scanning ? 'Waiting for scan…' : isEditing ? 'Save Changes' : 'Save Receipt'}
            labels={['Saving…', 'Waiting for scan…', isEditing ? 'Save Changes' : 'Save Receipt']}
          />
        </button>

        {isEditing && (
          <button
            type="button"
            onClick={handleDelete}
            className="w-full py-2.5 border border-red-200 text-red-500 rounded-xl hover:bg-red-50 active:bg-red-50 transition text-sm font-medium"
          >
            Delete receipt
          </button>
        )}
      </fieldset>
      </form>
    </div>
    </>
  )
}
