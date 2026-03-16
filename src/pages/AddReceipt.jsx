import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { fetchCoreRoommates } from './Settings.jsx'
import { useDialog } from '../lib/useDialog.jsx'
import { CATEGORIES, GEMINI_MODEL } from '../config.js'

function newItem(dbId = null) {
  return { id: crypto.randomUUID(), dbId, name: '', price: '', always_split: false, meal_local_id: null }
}

function newMeal(dbId = null) {
  return { local_id: crypto.randomUUID(), dbId, name: '', fee: '' }
}

export default function AddReceipt() {
  const { id: tripId, receiptId } = useParams()
  const isEditing = !!receiptId
  const isStandalone = !tripId
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [trip, setTrip] = useState(null)
  const [storeName, setStoreName] = useState('')
  const [paidBy, setPaidBy] = useState('')
  const [knownNames, setKnownNames] = useState([])
  const [coreRoommates, setCoreRoommates] = useState([])
  const [paidByOpen, setPaidByOpen] = useState(false)
  const paidByRef = useRef(null)
  const [lineItems, setLineItems] = useState([newItem()])
  const [meals, setMeals] = useState([])
  const [originalDbIds, setOriginalDbIds] = useState(new Set())
  const [originalMealDbIds, setOriginalMealDbIds] = useState(new Set())
  const [category, setCategory] = useState('Groceries')
  const [receiptDate, setReceiptDate] = useState(() => {
    if (!tripId && !receiptId) return searchParams.get('date') || new Date().toISOString().slice(0, 10)
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
  const scanInputRef = useRef(null)
  const [draggingItemId, setDraggingItemId] = useState(null)
  const [dragOverTarget, setDragOverTarget] = useState(null) // null = ungrouped, meal.local_id = that meal
  const loadComplete = useRef(false)
  const { confirm, showAlert, DialogUI } = useDialog()

  useEffect(() => {
    async function load() {
      const core = await fetchCoreRoommates()
      setCoreRoommates(core)

      if (isStandalone) {
        // Standalone mode: no trip, load known paid_by names from all standalone receipts
        const [{ data: standaloneReceipts }] = await Promise.all([
          supabase.from('receipts').select('paid_by').not('receipt_date', 'is', null),
        ])
        const names = new Set((standaloneReceipts || []).map(r => r.paid_by))
        setKnownNames([...names].filter(Boolean))

        if (isEditing) {
          const { data: receipt } = await supabase
            .from('receipts').select('*').eq('id', receiptId).single()
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
        } else {
          const savedName = localStorage.getItem('global-name')
          if (savedName) setPaidBy(savedName)
          setReceiptMembers(core)
        }
        loadComplete.current = true
        return
      }

      // Trip-linked mode (legacy)
      const { data: tripData } = await supabase.from('trips').select('*').eq('id', tripId).single()
      setTrip(tripData)

      const { data: receipts } = await supabase.from('receipts').select('paid_by').eq('trip_id', tripId)
      const names = new Set((receipts || []).map(r => r.paid_by))
      setKnownNames([...names].filter(Boolean))

      if (isEditing) {
        const { data: receipt } = await supabase
          .from('receipts').select('*').eq('id', receiptId).single()
        if (receipt) {
          setStoreName(receipt.store_name)
          setPaidBy(receipt.paid_by)
          setCategory(receipt.category || 'Groceries')
          setTip(receipt.tip ? String(receipt.tip) : '')
          setTax(receipt.tax ? String(receipt.tax) : '')
          setFees(receipt.fees ? String(receipt.fees) : '')
        }

        const [{ data: existingItems }, { data: existingMeals }] = await Promise.all([
          supabase.from('items').select('*').eq('receipt_id', receiptId).order('created_at'),
          supabase.from('meals').select('*').eq('receipt_id', receiptId).order('created_at'),
        ])

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
          meal_local_id: item.meal_id ? (dbIdToLocalId.get(item.meal_id) || null) : null,
        }))
        setOriginalDbIds(new Set(loaded.map(i => i.dbId)))
        setLineItems([...loaded, newItem()])
      } else {
        const savedName = localStorage.getItem('global-name')
        if (savedName) setPaidBy(savedName)
      }
      loadComplete.current = true
    }
    load()
  }, [tripId, receiptId, isEditing, isStandalone])

  useEffect(() => {
    function handleClick(e) {
      if (paidByRef.current && !paidByRef.current.contains(e.target)) {
        setPaidByOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

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
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    const apiKey = localStorage.getItem('gemini-api-key')
    if (!apiKey) {
      await showAlert('Add your free Gemini API key in Settings to use receipt scanning.', { title: 'No API key set' })
      return
    }
    setScanning(true)
    try {
      const results = await Promise.all(Array.from(files).map(f => scanOneFile(f, apiKey)))

      // Use store name + category from the first result that has them
      const firstStore = results.find(r => r.store_name)
      const firstCat = results.find(r => r.category)
      if (firstStore?.store_name) { setStoreName(toTitleCase(firstStore.store_name)); setErrors(v => ({ ...v, storeName: undefined })) }
      if (firstCat?.category && ['Groceries', 'Dining', 'Transportation', 'Misc'].includes(firstCat.category)) {
        setCategory(firstCat.category)
      }

      // Sum tip/tax/fees across all results (handles multi-page receipts)
      const totalTip = results.reduce((s, r) => s + (r.tip || 0), 0)
      const totalTax = results.reduce((s, r) => s + (r.tax || 0), 0)
      const totalFees = results.reduce((s, r) => s + (r.fees || 0), 0)
      if (totalTip > 0) setTip(String(totalTip.toFixed(2)))
      if (totalTax > 0) setTax(String(totalTax.toFixed(2)))
      if (totalFees > 0) setFees(String(totalFees.toFixed(2)))

      // Group results by store name — photos of the same receipt share the same store name.
      // Deduplicate within each group (same receipt, multiple photos) but not across groups.
      const groups = new Map()
      for (const result of results) {
        const storeKey = String(result.store_name || '').toLowerCase().trim() || '__unknown__'
        if (!groups.has(storeKey)) groups.set(storeKey, [])
        groups.get(storeKey).push(result)
      }

      const merged = []
      for (const groupResults of groups.values()) {
        const seen = new Set()
        for (const result of groupResults) {
          for (const item of (result.items || [])) {
            const key = String(item.name || '').toLowerCase().replace(/\s+/g, ' ').trim()
            if (!key || seen.has(key) || !Number(item.price)) continue
            seen.add(key)
            merged.push({
              ...newItem(),
              name: toTitleCase(String(item.name || '')),
              price: String(Number(item.price || 0).toFixed(2)),
            })
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
        setLineItems([...finalItems, newItem()])
        setErrors(v => ({ ...v, items: undefined }))
      }
      markDirty()
    } catch (err) {
      await showAlert(err.message, { title: 'Scan failed' })
    } finally {
      setScanning(false)
    }
  }

  async function handleBack() {
    if (isDirty && !await confirm('You have unsaved changes. Leave without saving?', {
      title: 'Unsaved changes',
      confirmLabel: 'Leave',
      danger: true,
    })) return
    if (isStandalone) {
      if (isEditing) navigate(`/receipt/${receiptId}`)
      else navigate('/')
    } else {
      navigate(`/trip/${tripId}`)
    }
  }

  function updateItem(itemId, field, value) {
    markDirty()
    setLineItems(prev => {
      const next = prev.map(item => item.id === itemId ? { ...item, [field]: value } : item)
      const item = next.find(i => i.id === itemId)
      // Auto-add blank row at end of ungrouped section when editing the last ungrouped item
      if (item && !item.meal_local_id) {
        const ungrouped = next.filter(i => !i.meal_local_id)
        const isLastUngrouped = ungrouped[ungrouped.length - 1]?.id === item.id
        if (isLastUngrouped && (item.name.trim() || item.price !== '')) {
          return [...next, newItem()]
        }
      }
      return next
    })
  }

  function removeItem(itemId) {
    markDirty()
    setLineItems(prev => {
      const next = prev.filter(i => i.id !== itemId)
      if (next.length === 0) return [newItem()]
      // Always keep at least one ungrouped blank row
      const hasUngroupedBlank = next.some(i => !i.meal_local_id && !i.name.trim() && i.price === '')
      if (!hasUngroupedBlank) return [...next, newItem()]
      return next
    })
  }

  function addMeal() {
    markDirty()
    setMeals(prev => [...prev, newMeal()])
  }

  function updateMeal(localId, field, value) {
    markDirty()
    setMeals(prev => prev.map(m => m.local_id === localId ? { ...m, [field]: value } : m))
    if (field === 'name') setErrors(v => ({ ...v, [`meal-${localId}`]: undefined }))
  }

  function removeMeal(localId) {
    markDirty()
    setLineItems(prev => prev.map(item =>
      item.meal_local_id === localId ? { ...item, meal_local_id: null } : item
    ))
    setMeals(prev => prev.filter(m => m.local_id !== localId))
  }

  function addItemToMeal(mealLocalId) {
    markDirty()
    setLineItems(prev => [...prev, { ...newItem(), meal_local_id: mealLocalId }])
  }

  // Drag and drop
  function handleDragStart(e, itemId) {
    setDraggingItemId(itemId)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragEnd() {
    setDraggingItemId(null)
    setDragOverTarget(null)
  }

  function handleDragOver(e, targetId) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverTarget(targetId)
  }

  function handleDrop(e, targetMealLocalId) {
    e.preventDefault()
    if (!draggingItemId) return
    markDirty()
    setLineItems(prev => prev.map(item =>
      item.id === draggingItemId ? { ...item, meal_local_id: targetMealLocalId } : item
    ))
    setDraggingItemId(null)
    setDragOverTarget(null)
  }

  function filledItems() {
    return lineItems.filter(item => item.name.trim() || item.price !== '')
  }

  function validate() {
    const errs = {}
    if (!storeName.trim()) errs.storeName = 'Store name is required.'
    if (!paidBy.trim()) errs.paidBy = 'Payer name is required.'
    if (filledItems().length === 0) errs.items = 'Add at least one item.'
    filledItems().forEach(item => {
      if (!item.name.trim()) errs[`name-${item.id}`] = 'Required'
      const p = parseFloat(item.price)
      if (isNaN(p) || p < 0) errs[`price-${item.id}`] = 'Invalid'
    })
    meals.forEach(meal => {
      if (!meal.name.trim()) errs[`meal-${meal.local_id}`] = 'Meal name required'
    })
    return errs
  }

  async function saveMeals(receiptDbId) {
    const mealLocalToDbId = new Map()
    const newMeals = meals.filter(m => m.name.trim() && !m.dbId)
    const existingMeals = meals.filter(m => m.name.trim() && m.dbId)

    // Insert new meals in bulk and get back their IDs
    if (newMeals.length > 0) {
      const { data } = await supabase.from('meals')
        .insert(newMeals.map(m => ({ receipt_id: receiptDbId, name: m.name.trim(), fee: parseFloat(m.fee) || 0 })))
        .select()
      ;(data || []).forEach((row, i) => mealLocalToDbId.set(newMeals[i].local_id, row.id))
    }

    // Update existing meals
    for (const meal of existingMeals) {
      await supabase.from('meals').update({ name: meal.name.trim(), fee: parseFloat(meal.fee) || 0 }).eq('id', meal.dbId)
      mealLocalToDbId.set(meal.local_id, meal.dbId)
    }

    return mealLocalToDbId
  }

  async function handleSave(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) { setErrors(errs); return }

    setSaving(true)

    if (isEditing) {
      const updatePayload = { store_name: storeName.trim(), paid_by: paidBy.trim(), category, tip: parseFloat(tip) || 0, tax: parseFloat(tax) || 0, fees: parseFloat(fees) || 0 }
      if (isStandalone) {
        updatePayload.receipt_date = receiptDate || null
        updatePayload.members = receiptMembers
      }
      const { error: updateErr } = await supabase
        .from('receipts')
        .update(updatePayload)
        .eq('id', receiptId)
      if (updateErr) { await showAlert(updateErr.message, { title: 'Error updating receipt' }); setSaving(false); return }

      const mealLocalToDbId = await saveMeals(receiptId)

      // Delete removed meals
      const survivingMealDbIds = new Set(meals.filter(m => m.dbId).map(m => m.dbId))
      const mealsToDelete = [...originalMealDbIds].filter(id => !survivingMealDbIds.has(id))
      if (mealsToDelete.length > 0) {
        await supabase.from('meals').delete().in('id', mealsToDelete)
      }

      const filled = filledItems()
      const toUpdate = filled.filter(i => i.dbId)
      for (const item of toUpdate) {
        await supabase.from('items')
          .update({
            name: item.name.trim(),
            price: parseFloat(item.price),
            always_split: item.always_split,
            meal_id: item.meal_local_id ? (mealLocalToDbId.get(item.meal_local_id) || null) : null,
          })
          .eq('id', item.dbId)
      }

      const toInsert = filled.filter(i => !i.dbId)
      if (toInsert.length > 0) {
        await supabase.from('items').insert(
          toInsert.map(item => ({
            receipt_id: receiptId,
            name: item.name.trim(),
            price: parseFloat(item.price),
            always_split: item.always_split,
            meal_id: item.meal_local_id ? (mealLocalToDbId.get(item.meal_local_id) || null) : null,
          }))
        )
      }

      const survivingDbIds = new Set(toUpdate.map(i => i.dbId))
      const toDelete = [...originalDbIds].filter(id => !survivingDbIds.has(id))
      if (toDelete.length > 0) {
        await supabase.from('items').delete().in('id', toDelete)
      }
    } else {
      const insertPayload = {
        store_name: storeName.trim(),
        paid_by: paidBy.trim(),
        category,
        tip: parseFloat(tip) || 0,
        tax: parseFloat(tax) || 0,
        fees: parseFloat(fees) || 0,
      }
      if (isStandalone) {
        insertPayload.receipt_date = receiptDate || null
        insertPayload.members = receiptMembers
      } else {
        insertPayload.trip_id = tripId
      }
      const { data: receipt, error: receiptErr } = await supabase
        .from('receipts')
        .insert(insertPayload)
        .select()
        .single()
      if (receiptErr) { await showAlert(receiptErr.message, { title: 'Error saving receipt' }); setSaving(false); return }

      const mealLocalToDbId = await saveMeals(receipt.id)

      const { error: itemsErr } = await supabase.from('items').insert(
        filledItems().map(item => ({
          receipt_id: receipt.id,
          name: item.name.trim(),
          price: parseFloat(item.price),
          always_split: item.always_split,
          meal_id: item.meal_local_id ? (mealLocalToDbId.get(item.meal_local_id) || null) : null,
        }))
      )
      if (itemsErr) { await showAlert(itemsErr.message, { title: 'Error saving items' }); setSaving(false); return }

      if (isStandalone) { navigate(`/receipt/${receipt.id}`); return }
    }

    if (isStandalone) {
      navigate(`/receipt/${receiptId}`)
    } else {
      navigate(`/trip/${tripId}`)
    }
  }

  async function handleDelete() {
    if (!await confirm('All items and claims on this receipt will be removed. This cannot be undone.', {
      title: 'Delete receipt?',
      confirmLabel: 'Delete',
      danger: true,
    })) return
    await supabase.from('receipts').delete().eq('id', receiptId)
    if (isStandalone) navigate('/')
    else navigate(`/trip/${tripId}`)
  }

  if (!isStandalone && trip?.closed) {
    return (
      <div className="max-w-xl mx-auto p-8 text-center text-gray-500">
        This trip is closed.{' '}
        <button onClick={handleBack} className="text-gray-600 underline">Go back</button>
      </div>
    )
  }

  const ungroupedItems = lineItems.filter(i => !i.meal_local_id)
  const isBlankItem = item => !item.name.trim() && item.price === ''

  function renderItemRow(item) {
    const isDragging = draggingItemId === item.id
    const canDrag = !isBlankItem(item)
    return (
      <div
        key={item.id}
        className={`flex gap-2 items-start transition-opacity ${isDragging ? 'opacity-30' : ''}`}
        draggable={canDrag || undefined}
        onDragStart={canDrag ? e => handleDragStart(e, item.id) : undefined}
        onDragEnd={handleDragEnd}
        onDragOver={e => e.preventDefault()}
      >
        <div
          className={`mt-2.5 text-sm leading-none select-none ${canDrag ? 'text-gray-300 cursor-grab active:cursor-grabbing' : 'text-transparent'}`}
          title="Drag to move to a meal"
        >
          ⠿
        </div>
        <div className="flex-1">
          <input
            type="text"
            value={item.name}
            onChange={e => { updateItem(item.id, 'name', e.target.value); setErrors(v => ({ ...v, [`name-${item.id}`]: undefined })) }}
            placeholder="Item name"
            className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 ${errors[`name-${item.id}`] ? 'border-red-400' : 'border-gray-300'}`}
          />
        </div>
        <div className="w-28">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 leading-none text-gray-400 text-sm">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={item.price}
              onChange={e => { updateItem(item.id, 'price', e.target.value); setErrors(v => ({ ...v, [`price-${item.id}`]: undefined })) }}
              placeholder="0.00"
              className={`w-full border rounded-lg pl-6 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 ${errors[`price-${item.id}`] ? 'border-red-400' : 'border-gray-300'}`}
            />
          </div>
        </div>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => updateItem(item.id, 'always_split', !item.always_split)}
          title={item.always_split ? 'Everyone always splits this — click to remove' : 'Click to always split with everyone'}
          className={`mt-1.5 text-base transition ${item.always_split ? 'text-accent-500' : 'text-gray-300 hover:text-gray-400'}`}
          aria-label="Toggle always split"
        >
          {item.always_split ? '🔒' : '🔓'}
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => removeItem(item.id)}
          className="mt-2 text-gray-400 hover:text-red-500 transition text-sm"
          aria-label="Remove item"
        >
          ✕
        </button>
      </div>
    )
  }

  return (
    <>
    {DialogUI}
    <div className="max-w-xl mx-auto p-4 py-8">
      <button onClick={handleBack} className="text-sm text-gray-500 hover:text-gray-700 hover:underline mb-2 inline-block">
        {isStandalone ? '← Back' : '← Back to trip'}
      </button>
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
          onChange={e => { if (e.target.files?.length) scanReceipts(e.target.files); e.target.value = '' }}
        />
      </div>

      {isEditing && (
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          Existing claims are preserved. Only claims on items you remove will be cleared.
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-5">
        {/* Date (standalone only) */}
        {isStandalone && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input
              type="date"
              value={receiptDate}
              onChange={e => { markDirty(); setReceiptDate(e.target.value) }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-400"
            />
          </div>
        )}

        {/* Members (standalone only) */}
        {isStandalone && (
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
                    const name = memberInput.trim()
                    if (name && !receiptMembers.includes(name)) { markDirty(); setReceiptMembers(prev => [...prev, name]) }
                    setMemberInput('')
                  }
                }}
                placeholder="Add someone…"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
              />
              <button
                type="button"
                onClick={() => {
                  const name = memberInput.trim()
                  if (name && !receiptMembers.includes(name)) { markDirty(); setReceiptMembers(prev => [...prev, name]) }
                  setMemberInput('')
                }}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition text-gray-600"
              >
                Add
              </button>
            </div>
          </div>
        )}

        {/* Store name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Store name</label>
          <input
            type="text"
            value={storeName}
            onChange={e => { markDirty(); setStoreName(e.target.value); setErrors(v => ({ ...v, storeName: undefined })) }}
            placeholder="e.g. Costco"
            className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-400 ${errors.storeName ? 'border-red-400' : 'border-gray-300'}`}
            autoFocus={!isEditing}
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
                onClick={() => { markDirty(); setCategory(label) }}
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
          <div className="relative" ref={paidByRef}>
            <input
              type="text"
              value={paidBy}
              onChange={e => { markDirty(); setPaidBy(e.target.value); setErrors(v => ({ ...v, paidBy: undefined })); setPaidByOpen(true) }}
              onFocus={() => setPaidByOpen(true)}
              placeholder="Who paid?"
              autoComplete="off"
              className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-400 ${errors.paidBy ? 'border-red-400' : 'border-gray-300'}`}
            />
            {paidByOpen && (() => {
              const allSuggestions = [...new Set([...coreRoommates, ...knownNames])]
              const isExactMatch = allSuggestions.some(n => n.toLowerCase() === paidBy.toLowerCase())
              const suggestions = (paidBy === '' || isExactMatch)
                ? allSuggestions
                : allSuggestions.filter(n => n.toLowerCase().includes(paidBy.toLowerCase()))
              return suggestions.length > 0 ? (
                <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                  {suggestions.map(name => (
                    <li key={name}>
                      <button
                        type="button"
                        onMouseDown={e => {
                          e.preventDefault()
                          markDirty()
                          setPaidBy(name)
                          setErrors(v => ({ ...v, paidBy: undefined }))
                          setPaidByOpen(false)
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent-50 hover:text-accent-700 transition-colors"
                      >
                        {name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null
            })()}
          </div>
          {errors.paidBy && <p className="text-xs text-red-500 mt-1">{errors.paidBy}</p>}
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">Items</label>
            <span className="text-xs text-gray-400">🔒 always splits with everyone · ⠿ drag to regroup</span>
          </div>
          {errors.items && <p className="text-xs text-red-500 mb-2">{errors.items}</p>}

          {/* Ungrouped items drop zone */}
          <div
            className={`space-y-2 min-h-[2.5rem] rounded-lg p-1 transition-colors ${dragOverTarget === null && draggingItemId ? 'bg-accent-50 ring-2 ring-accent-200' : ''}`}
            onDragOver={e => handleDragOver(e, null)}
            onDrop={e => handleDrop(e, null)}
          >
            {ungroupedItems.map(item => renderItemRow(item))}
            {dragOverTarget === null && draggingItemId && (
              <p className="text-xs text-accent-400 text-center py-2">Drop here to ungroup</p>
            )}
          </div>

          {/* Meal groups */}
          {meals.map(meal => {
            const mealItems = lineItems.filter(i => i.meal_local_id === meal.local_id)
            const isDragTarget = dragOverTarget === meal.local_id && !!draggingItemId
            return (
              <div
                key={meal.local_id}
                className={`mt-3 border rounded-xl overflow-hidden transition-colors ${isDragTarget ? 'ring-2 ring-accent-300 border-accent-300' : 'border-gray-200'}`}
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
                      type="number"
                      min="0"
                      step="0.01"
                      value={meal.fee}
                      onChange={e => updateMeal(meal.local_id, 'fee', e.target.value)}
                      placeholder="0.00"
                      className="w-full border border-gray-200 rounded-md pl-9 pr-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent-400"
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

                {/* Meal items drop zone */}
                <div
                  className={`p-2 space-y-2 min-h-[3rem] transition-colors ${isDragTarget ? 'bg-accent-50' : 'bg-white'}`}
                  onDragOver={e => handleDragOver(e, meal.local_id)}
                  onDrop={e => handleDrop(e, meal.local_id)}
                >
                  {mealItems.map(item => renderItemRow(item))}
                  {isDragTarget && mealItems.length === 0 && (
                    <p className="text-xs text-accent-400 text-center py-2">Drop here</p>
                  )}
                  {!isDragTarget && mealItems.length === 0 && (
                    <p className="text-xs text-gray-300 text-center py-2">Drag items here or add below</p>
                  )}
                </div>

                {/* Add item to meal */}
                <div className="px-3 pb-2 pt-1 bg-white border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => addItemToMeal(meal.local_id)}
                    className="text-xs text-accent-500 hover:text-accent-700 transition"
                  >
                    + Add item
                  </button>
                </div>
              </div>
            )
          })}

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
                type="number" min="0" step="0.01"
                value={tip}
                onChange={e => { markDirty(); setTip(e.target.value) }}
                placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg pl-6 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
              />
            </div>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Tax</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 leading-none text-gray-400 text-sm">$</span>
              <input
                type="number" min="0" step="0.01"
                value={tax}
                onChange={e => { markDirty(); setTax(e.target.value) }}
                placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg pl-6 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
              />
            </div>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Fees</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 leading-none text-gray-400 text-sm">$</span>
              <input
                type="number" min="0" step="0.01"
                value={fees}
                onChange={e => { markDirty(); setFees(e.target.value) }}
                placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg pl-6 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
              />
            </div>
          </div>
        </div>

        {/* Total preview */}
        {(() => {
          const itemsTotal = filledItems().reduce((s, i) => s + (parseFloat(i.price) || 0), 0)
          const tipAmt = parseFloat(tip) || 0
          const taxAmt = parseFloat(tax) || 0
          const feesAmt = parseFloat(fees) || 0
          const mealFeesAmt = meals.reduce((s, m) => s + (parseFloat(m.fee) || 0), 0)
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
