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
import LoadError from '../components/LoadError.jsx'
import { parseAmount, amountOrZero, toggleSign } from '../lib/amount.js'
import { useGoBack, canGoBack } from '../lib/useGoBack.js'
import { useUnsavedChanges, leaveWithoutPrompt } from '../lib/unsaved.jsx'
import { invalidateSearch } from '../lib/search.jsx'
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
  const [originalDbIds, setOriginalDbIds] = useState(new Set())
  const [originalMealDbIds, setOriginalMealDbIds] = useState(new Set())
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
  const checkinResetPending = useRef(false)
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
        setOriginalMealDbIds(new Set(loadedMeals.map(m => m.dbId)))

        const dbIdToLocalId = new Map(loadedMeals.map(m => [m.dbId, m.local_id]))

        const loaded = (existingItems || []).map(item => ({
          id: crypto.randomUUID(),
          dbId: item.id,
          name: item.name,
          price: String(item.price),
          always_split: item.always_split || false,
          wasAlwaysSplit: item.always_split || false,
          meal_local_id: item.meal_id ? (dbIdToLocalId.get(item.meal_id) || null) : null,
        }))
        setOriginalDbIds(new Set(loaded.map(i => i.dbId)))
        setLineItems(withBlankRows(loaded, loadedMeals.map(m => m.local_id)))
      } else {
        if (myName) setPaidBy(myName)
        // Default: the group's regular (non-guest) people, plus me
        setReceiptMembers([...new Set([...core, ...(myName ? [myName] : [])])])
      }
      loadComplete.current = true
    }
    load()
  }, [receiptId, isEditing, group.id, loadAttempt])

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
    if (!storeName.trim()) errs.storeName = 'Store name is required.'
    if (!paidBy.trim()) errs.paidBy = 'Payer name is required.'
    if (filledItems().length === 0) errs.items = 'Add at least one item.'
    filledItems().forEach(item => {
      if (!item.name.trim()) errs[`name-${item.id}`] = 'Required'
      const p = parseAmount(item.price)
      if (isNaN(p)) errs[`price-${item.id}`] = 'Invalid'
    })
    meals.forEach(meal => {
      if (!meal.name.trim()) errs[`meal-${meal.local_id}`] = 'Meal name required'
      if (!validExtra(meal.fee)) errs[`mealfee-${meal.local_id}`] = 'Invalid'
    })
    if (!validExtra(tip)) errs.tip = 'Invalid'
    if (!validExtra(tax)) errs.tax = 'Invalid'
    if (!validExtra(fees)) errs.fees = 'Invalid'
    return errs
  }

  // Every database step is checked: a failure stops the save and says so,
  // instead of half-saving and moving on as if it worked
  async function must(query, what) {
    const { data, error } = await query
    if (error) throw new Error(`${what}: ${error.message}`)
    return data
  }

  // Editing: rows saved before a later step fails keep their database ids, so
  // "try again" updates them instead of adding them a second time
  function rememberSaved(kind, localToDbId) {
    if (!isEditing || localToDbId.size === 0) return
    const ids = [...localToDbId.values()]
    if (kind === 'meals') {
      setMeals(prev => prev.map(m => localToDbId.has(m.local_id) ? { ...m, dbId: localToDbId.get(m.local_id) } : m))
      setOriginalMealDbIds(prev => new Set([...prev, ...ids]))
    } else {
      setLineItems(prev => prev.map(i => localToDbId.has(i.id) ? { ...i, dbId: localToDbId.get(i.id) } : i))
      setOriginalDbIds(prev => new Set([...prev, ...ids]))
    }
  }

  async function saveMeals(receiptDbId) {
    const mealLocalToDbId = new Map()
    const newMeals = meals.filter(m => m.name.trim() && !m.dbId)
    const existingMeals = meals.filter(m => m.name.trim() && m.dbId)

    // Insert new meals one at a time: meals are listed by when they were
    // created, so each gets its own time and they keep the order shown here
    for (const m of newMeals) {
      const row = await must(supabase.from('meals')
        .insert({ receipt_id: receiptDbId, name: m.name.trim(), fee: amountOrZero(m.fee) })
        .select().single(), 'Could not save meals')
      mealLocalToDbId.set(m.local_id, row.id)
      rememberSaved('meals', new Map([[m.local_id, row.id]]))
    }

    // Update existing meals
    for (const meal of existingMeals) {
      await must(supabase.from('meals').update({ name: meal.name.trim(), fee: amountOrZero(meal.fee) }).eq('id', meal.dbId), 'Could not update a meal')
      mealLocalToDbId.set(meal.local_id, meal.dbId)
    }

    return mealLocalToDbId
  }

  const itemRow = (item, receiptDbId, mealLocalToDbId, position) => ({
    receipt_id: receiptDbId,
    name: item.name.trim(),
    price: parseAmount(item.price),
    always_split: item.always_split,
    meal_id: item.meal_local_id ? (mealLocalToDbId.get(item.meal_local_id) || null) : null,
    position,
  })

  async function handleSave(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      // The first problem may be far up the page: bring it into view
      requestAnimationFrame(() => {
        const field = formRef.current?.querySelector('.border-red-400, .placeholder-red-400, .text-red-500')
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

    const receiptFields = {
      store_name: storeName.trim(), paid_by_member: paidById, category,
      tip: amountOrZero(tip), tax: amountOrZero(tax), fees: amountOrZero(fees),
      receipt_date: receiptDate, member_ids: memberIds,
    }

    if (isEditing) {
      try {
        await must(supabase.from('receipts').update(receiptFields).eq('id', receiptId), 'Could not update the receipt')
        const mealLocalToDbId = await saveMeals(receiptId)

        // Delete removed meals
        const survivingMealDbIds = new Set(meals.filter(m => m.dbId).map(m => m.dbId))
        const mealsToDelete = [...originalMealDbIds].filter(id => !survivingMealDbIds.has(id))
        if (mealsToDelete.length > 0) {
          await must(supabase.from('meals').update({ deleted_at: new Date().toISOString() }).in('id', mealsToDelete), 'Could not remove meals')
        }

        const filled = filledItems()
        const position = new Map(filled.map((item, i) => [item.id, i]))
        const toUpdate = filled.filter(i => i.dbId)
        for (const item of toUpdate) {
          const { receipt_id, ...fields } = itemRow(item, receiptId, mealLocalToDbId, position.get(item.id))
          await must(supabase.from('items').update(fields).eq('id', item.dbId), `Could not update "${item.name.trim()}"`)
        }

        const toInsert = filled.filter(i => !i.dbId)
        if (toInsert.length > 0) {
          const rows = await must(supabase.from('items')
            .insert(toInsert.map(item => itemRow(item, receiptId, mealLocalToDbId, position.get(item.id))))
            .select('id'), 'Could not add new items')
          rememberSaved('items', new Map(toInsert.map((item, i) => [item.id, rows[i].id])))
        }

        const survivingDbIds = new Set(toUpdate.map(i => i.dbId))
        const toDelete = [...originalDbIds].filter(id => !survivingDbIds.has(id))
        if (toDelete.length > 0) {
          await must(supabase.from('items').update({ deleted_at: new Date().toISOString() }).in('id', toDelete), 'Could not remove items')
        }

        // People taken off the receipt: their check-offs and check-in go too,
        // so they don't keep owing on it. An empty list means everyone is on
        // it, so nobody is taken off; otherwise anyone not on the new list is
        // (including people who were on it only because the list was empty).
        const onReceipt = [...new Set([...memberIds, paidById])]
        if (memberIds.length > 0 && originalDbIds.size > 0) {
          const notOn = `(${onReceipt.join(',')})`
          await must(supabase.from('claims').delete().not('member_id', 'in', notOn).in('item_id', [...originalDbIds]), `Could not clear removed people's check-offs`)
          await must(supabase.from('checkins').delete().eq('receipt_id', receiptId).not('member_id', 'in', notOn), `Could not clear removed people's check-ins`)
        }

        // New items, or items newly locked 🔒 (split with everyone): everyone
        // else checks in again, so they see them and their split includes them
        // (Remembered across a failed attempt: on "try again" the new items
        // are already saved, but everyone still needs to check in again.)
        const newlyLocked = toUpdate.filter(i => i.always_split && !i.wasAlwaysSplit)
        if (toInsert.length > 0 || newlyLocked.length > 0) checkinResetPending.current = true
        if (checkinResetPending.current && myMember) {
          await must(supabase.from('checkins').delete().eq('receipt_id', receiptId).neq('member_id', myMember.id), 'Could not ask everyone to check in again')
          checkinResetPending.current = false
        }
      } catch (err) {
        await showAlert(`${err.message}. Some changes may not have saved; check the receipt and try again.`, { title: 'Error saving receipt' })
        setSaving(false)
        return
      }
      invalidateSearch(group.id)
      leaveWithoutPrompt()
      leave()
      return
    }

    let receipt
    try {
      receipt = await must(supabase.from('receipts').insert({ group_id: group.id, ...receiptFields }).select().single(), 'Could not save the receipt')
    } catch (err) {
      await showAlert(err.message, { title: 'Error saving receipt' }); setSaving(false); return
    }
    try {
      const mealLocalToDbId = await saveMeals(receipt.id)
      await must(supabase.from('items').insert(filledItems().map((item, i) => itemRow(item, receipt.id, mealLocalToDbId, i))), 'Could not save the items')
    } catch (err) {
      // Undo the half-made receipt and stay on the form, so everything typed
      // is still here to try again
      const { error: undoError } = await supabase.from('receipts').update({ deleted_at: new Date().toISOString() }).eq('id', receipt.id)
      await showAlert(undoError
        ? `${err.message}. The receipt may have been partly saved: check your receipts before trying again.`
        : `${err.message}. The receipt wasn't saved; try again.`, { title: 'Error saving receipt' })
      setSaving(false)
      return
    }
    // The new receipt takes the form's place, so Back from it doesn't reopen the form
    invalidateSearch(group.id)
    leaveWithoutPrompt()
    navigate(`/receipt/${receipt.id}`, { replace: true })
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
      <div className="flex gap-2 items-start">
        <DragHandle handleProps={handleProps} disabled={!canDrag} />
        <div className="flex-1">
          <input
            type="text"
            value={item.name}
            enterKeyHint="next"
            onChange={e => { updateItem(item.id, 'name', e.target.value); setErrors(v => ({ ...v, [`name-${item.id}`]: undefined })) }}
            placeholder="Item name"
            className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 ${errors[`name-${item.id}`] ? 'border-red-400' : 'border-gray-300'}`}
          />
        </div>
        <div className="w-28">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 leading-none text-gray-400 text-sm">$</span>
            <input
              type="text"
              inputMode="decimal"
              enterKeyHint="next"
              value={item.price}
              onChange={e => { updateItem(item.id, 'price', e.target.value); setErrors(v => ({ ...v, [`price-${item.id}`]: undefined })) }}
              placeholder="0.00"
              className={`w-full border rounded-lg pl-6 pr-8 sm:pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 ${errors[`price-${item.id}`] ? 'border-red-400' : 'border-gray-300'}`}
            />
            {/* Phones: the number keypad has no minus key, so this makes a price
                negative (a discount). Keeps the keyboard open (no focus change). */}
            <button
              type="button"
              tabIndex={-1}
              onPointerDown={e => e.preventDefault()}
              onClick={() => { updateItem(item.id, 'price', toggleSign(item.price)); setErrors(v => ({ ...v, [`price-${item.id}`]: undefined })) }}
              aria-label="Make negative (discount)"
              className="sm:hidden absolute right-0.5 top-1/2 -translate-y-1/2 w-7 h-8 flex items-center justify-center rounded-md text-gray-400 active:bg-gray-100 text-sm"
            >
              ±
            </button>
          </div>
        </div>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => updateItem(item.id, 'always_split', !item.always_split)}
          title={item.always_split ? 'Split with everyone who checks in — click to unlock' : 'Click to split with everyone who checks in'}
          className={`w-8 h-10 -my-0.5 shrink-0 flex items-center justify-center text-base transition ${item.always_split ? 'text-accent-500' : 'text-gray-300 hover:text-gray-400'}`}
          aria-label="Toggle always split"
        >
          {item.always_split ? '🔒' : '🔓'}
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => removeItem(item.id)}
          className="w-8 h-10 -my-0.5 shrink-0 flex items-center justify-center text-gray-400 hover:text-red-500 transition text-sm"
          aria-label="Remove item"
        >
          ✕
        </button>
      </div>
        )}
      </SortableRow>
    )
  }

  if (loadError) return <LoadError onRetry={() => setLoadAttempt(n => n + 1)} />

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
          disabled={scanning}
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

      {isEditing && (
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          Everyone's check-offs are kept. If you add items, everyone else will need to check in again. Taking someone off the receipt clears their check-offs.
        </div>
      )}

      <form ref={formRef} onSubmit={handleSave} onKeyDown={handleFormKeyDown} className="space-y-5">
        {/* Date */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
          <input
            type="date"
            value={receiptDate}
            onChange={e => { markDirty(); setReceiptDate(e.target.value); setErrors(v => ({ ...v, receiptDate: undefined })) }}
            className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-400 ${errors.receiptDate ? 'border-red-400' : 'border-gray-300'}`}
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
                  className={`px-3 py-1 rounded-full text-sm font-medium border transition ${
                    selected ? 'bg-accent-600 text-white border-accent-600' : 'bg-white text-gray-500 border-gray-300 hover:border-accent-400'
                  }`}
                >
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
              className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
            />
            <button
              type="button"
              onClick={addTypedMember}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition text-gray-600"
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
            className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-400 ${errors.storeName ? 'border-red-400' : 'border-gray-300'}`}
            autoFocus={!isEditing && window.matchMedia('(min-width: 640px)').matches}
          />
          {errors.storeName && <p className="text-xs text-red-500 mt-1">{errors.storeName}</p>}
        </div>

        {/* Category */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
          <div className="flex gap-2 flex-wrap">
            {CATEGORIES.map(({ label, color: active }) => (
              <button
                key={label}
                type="button"
                onClick={() => { markDirty(); categoryPicked.current = true; setCategory(label) }}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ${
                  category === label ? active : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600'
                }`}
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
          <select
            value={paidBy}
            onChange={e => pickPayer(e.target.value)}
            className={`w-full border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-accent-400 ${errors.paidBy ? 'border-red-400' : 'border-gray-300'} ${paidBy ? 'text-gray-900' : 'text-gray-400'}`}
          >
            <option value="" disabled>Who paid?</option>
            {[...new Set([...receiptMembers, ...knownNames, ...(paidBy ? [paidBy] : [])])].map(name => (
              <option key={name} value={name} className="text-gray-900">{name}</option>
            ))}
          </select>
          {errors.paidBy && <p className="text-xs text-red-500 mt-1">{errors.paidBy}</p>}
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">Items</label>
            <span className="text-xs text-gray-400">🔒 splits with everyone who checks in</span>
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
                  <input
                    type="text"
                    value={meal.name}
                    onChange={e => updateMeal(meal.local_id, 'name', e.target.value)}
                    placeholder="Meal name (e.g. Dinner)"
                    className={`flex-1 bg-transparent text-sm font-semibold text-gray-700 border-none outline-none focus:outline-none ${errors[`meal-${meal.local_id}`] ? 'placeholder-red-400' : 'placeholder-gray-400'}`}
                  />
                  {errors[`meal-${meal.local_id}`] && (
                    <span className="text-xs text-red-500">{errors[`meal-${meal.local_id}`]}</span>
                  )}
                  <div className="relative shrink-0 w-24">
                    <span className="absolute left-2 top-1.5 text-gray-400 text-xs">fee $</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={meal.fee}
                      onChange={e => { updateMeal(meal.local_id, 'fee', e.target.value); setErrors(v => ({ ...v, [`mealfee-${meal.local_id}`]: undefined })) }}
                      placeholder="0.00"
                      className={`w-full border rounded-md pl-9 pr-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent-400 ${errors[`mealfee-${meal.local_id}`] ? 'border-red-400' : 'border-gray-200'}`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeMeal(meal.local_id)}
                    className="text-xs text-gray-400 hover:text-red-500 transition shrink-0"
                  >
                    Remove
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
                value={tip}
                onChange={e => { markDirty(); setTip(e.target.value); setErrors(v => ({ ...v, tip: undefined })) }}
                placeholder="0.00"
                className={`w-full border rounded-lg pl-6 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 ${errors.tip ? 'border-red-400' : 'border-gray-300'}`}
              />
            </div>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Tax</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 leading-none text-gray-400 text-sm">$</span>
              <input
                type="text" inputMode="decimal"
                value={tax}
                onChange={e => { markDirty(); setTax(e.target.value); setErrors(v => ({ ...v, tax: undefined })) }}
                placeholder="0.00"
                className={`w-full border rounded-lg pl-6 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 ${errors.tax ? 'border-red-400' : 'border-gray-300'}`}
              />
            </div>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Fees</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 leading-none text-gray-400 text-sm">$</span>
              <input
                type="text" inputMode="decimal"
                value={fees}
                onChange={e => { markDirty(); setFees(e.target.value); setErrors(v => ({ ...v, fees: undefined })) }}
                placeholder="0.00"
                className={`w-full border rounded-lg pl-6 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 ${errors.fees ? 'border-red-400' : 'border-gray-300'}`}
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
                <span className="font-semibold text-gray-900">${grandTotal.toFixed(2)}</span>
              </div>
              {hasExtras && (
                <p className="text-xs text-gray-400 mt-0.5 text-right">
                  ${itemsTotal.toFixed(2)} items
                  {tipAmt > 0 && ` + $${tipAmt.toFixed(2)} tip`}
                  {taxAmt > 0 && ` + $${taxAmt.toFixed(2)} tax`}
                  {feesAmt > 0 && ` + $${feesAmt.toFixed(2)} fees`}
                  {mealFeesAmt > 0 && ` + $${mealFeesAmt.toFixed(2)} meal fees`}
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
          disabled={saving}
          className="w-full py-3 bg-accent-600 text-white font-semibold rounded-xl hover:bg-accent-700 transition disabled:opacity-50"
        >
          {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Save Receipt'}
        </button>

        {isEditing && (
          <button
            type="button"
            onClick={handleDelete}
            className="w-full py-2.5 border border-red-200 text-red-400 rounded-xl hover:bg-red-50 hover:text-red-500 transition text-sm font-medium"
          >
            Delete receipt
          </button>
        )}
      </form>
    </div>
    </>
  )
}
