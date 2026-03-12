import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

function newItem(dbId = null) {
  return { id: crypto.randomUUID(), dbId, name: '', price: '', always_split: false, meal_local_id: null }
}

function newMeal(dbId = null) {
  return { local_id: crypto.randomUUID(), dbId, name: '' }
}

export default function AddReceipt() {
  const { id: tripId, receiptId } = useParams()
  const isEditing = !!receiptId
  const navigate = useNavigate()

  const [trip, setTrip] = useState(null)
  const [storeName, setStoreName] = useState('')
  const [paidBy, setPaidBy] = useState('')
  const [knownNames, setKnownNames] = useState([])
  const [lineItems, setLineItems] = useState([newItem()])
  const [meals, setMeals] = useState([])
  const [originalDbIds, setOriginalDbIds] = useState(new Set())
  const [originalMealDbIds, setOriginalMealDbIds] = useState(new Set())
  const [tip, setTip] = useState('')
  const [tax, setTax] = useState('')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [isDirty, setIsDirty] = useState(false)
  const [draggingItemId, setDraggingItemId] = useState(null)
  const [dragOverTarget, setDragOverTarget] = useState(null) // null = ungrouped, meal.local_id = that meal
  const loadComplete = useRef(false)

  useEffect(() => {
    async function load() {
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
          setTip(receipt.tip ? String(receipt.tip) : '')
          setTax(receipt.tax ? String(receipt.tax) : '')
        }

        const [{ data: existingItems }, { data: existingMeals }] = await Promise.all([
          supabase.from('items').select('*').eq('receipt_id', receiptId).order('created_at'),
          supabase.from('meals').select('*').eq('receipt_id', receiptId).order('created_at'),
        ])

        const loadedMeals = (existingMeals || []).map(m => ({
          local_id: crypto.randomUUID(),
          dbId: m.id,
          name: m.name,
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
        const savedName = localStorage.getItem(`trip-name-${tripId}`)
        if (savedName) setPaidBy(savedName)
      }
      loadComplete.current = true
    }
    load()
  }, [tripId, receiptId, isEditing])

  function markDirty() {
    if (loadComplete.current) setIsDirty(true)
  }

  function handleBack() {
    if (isDirty && !window.confirm('You have unsaved changes. Leave without saving?')) return
    navigate(`/trip/${tripId}`)
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

  function updateMeal(localId, name) {
    markDirty()
    setMeals(prev => prev.map(m => m.local_id === localId ? { ...m, name } : m))
    setErrors(v => ({ ...v, [`meal-${localId}`]: undefined }))
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
        .insert(newMeals.map(m => ({ receipt_id: receiptDbId, name: m.name.trim() })))
        .select()
      ;(data || []).forEach((row, i) => mealLocalToDbId.set(newMeals[i].local_id, row.id))
    }

    // Update existing meals
    for (const meal of existingMeals) {
      await supabase.from('meals').update({ name: meal.name.trim() }).eq('id', meal.dbId)
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
      const { error: updateErr } = await supabase
        .from('receipts')
        .update({ store_name: storeName.trim(), paid_by: paidBy.trim(), tip: parseFloat(tip) || 0, tax: parseFloat(tax) || 0 })
        .eq('id', receiptId)
      if (updateErr) { alert('Error updating receipt: ' + updateErr.message); setSaving(false); return }

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
      const { data: receipt, error: receiptErr } = await supabase
        .from('receipts')
        .insert({ trip_id: tripId, store_name: storeName.trim(), paid_by: paidBy.trim(), tip: parseFloat(tip) || 0, tax: parseFloat(tax) || 0 })
        .select()
        .single()
      if (receiptErr) { alert('Error saving receipt: ' + receiptErr.message); setSaving(false); return }

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
      if (itemsErr) { alert('Error saving items: ' + itemsErr.message); setSaving(false); return }
    }

    navigate(`/trip/${tripId}`)
  }

  async function handleDelete() {
    if (!window.confirm('Delete this receipt and all its items? This cannot be undone.')) return
    await supabase.from('receipts').delete().eq('id', receiptId)
    navigate(`/trip/${tripId}`)
  }

  if (trip?.closed) {
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
        draggable={canDrag}
        onDragStart={canDrag ? e => handleDragStart(e, item.id) : undefined}
        onDragEnd={handleDragEnd}
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
            className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 ${errors[`name-${item.id}`] ? 'border-red-400' : 'border-gray-300'}`}
          />
        </div>
        <div className="w-28">
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-gray-400 text-sm">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={item.price}
              onChange={e => { updateItem(item.id, 'price', e.target.value); setErrors(v => ({ ...v, [`price-${item.id}`]: undefined })) }}
              placeholder="0.00"
              className={`w-full border rounded-lg pl-6 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 ${errors[`price-${item.id}`] ? 'border-red-400' : 'border-gray-300'}`}
            />
          </div>
        </div>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => updateItem(item.id, 'always_split', !item.always_split)}
          title={item.always_split ? 'Always split — click to allow unchecking' : 'Click to force everyone to split this item'}
          className={`mt-1.5 text-base transition ${item.always_split ? 'text-indigo-500' : 'text-gray-300 hover:text-gray-400'}`}
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
    <div className="max-w-xl mx-auto p-4 py-8">
      <button onClick={handleBack} className="text-sm text-gray-500 hover:text-gray-700 hover:underline mb-2 inline-block">
        ← Back to trip
      </button>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        {isEditing ? 'Edit Receipt' : 'Add Receipt'}
      </h1>

      {isEditing && (
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          Existing claims are preserved. Only claims on items you remove will be cleared.
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-5">
        {/* Store name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Store name</label>
          <input
            type="text"
            value={storeName}
            onChange={e => { markDirty(); setStoreName(e.target.value); setErrors(v => ({ ...v, storeName: undefined })) }}
            placeholder="e.g. Costco"
            className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${errors.storeName ? 'border-red-400' : 'border-gray-300'}`}
            autoFocus={!isEditing}
          />
          {errors.storeName && <p className="text-xs text-red-500 mt-1">{errors.storeName}</p>}
        </div>

        {/* Paid by */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Paid by</label>
          <input
            list="payer-names"
            type="text"
            value={paidBy}
            onChange={e => { markDirty(); setPaidBy(e.target.value); setErrors(v => ({ ...v, paidBy: undefined })) }}
            placeholder="Who paid?"
            className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${errors.paidBy ? 'border-red-400' : 'border-gray-300'}`}
          />
          <datalist id="payer-names">
            {knownNames.map(n => <option key={n} value={n} />)}
          </datalist>
          {errors.paidBy && <p className="text-xs text-red-500 mt-1">{errors.paidBy}</p>}
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">Items</label>
            <span className="text-xs text-gray-400">🔒 = everyone always splits · ⠿ drag to move</span>
          </div>
          {errors.items && <p className="text-xs text-red-500 mb-2">{errors.items}</p>}

          {/* Ungrouped items drop zone */}
          <div
            className={`space-y-2 min-h-[2.5rem] rounded-lg p-1 transition-colors ${dragOverTarget === null && draggingItemId ? 'bg-indigo-50 ring-2 ring-indigo-200' : ''}`}
            onDragOver={e => handleDragOver(e, null)}
            onDrop={e => handleDrop(e, null)}
          >
            {ungroupedItems.map(item => renderItemRow(item))}
            {dragOverTarget === null && draggingItemId && ungroupedItems.every(isBlankItem) && (
              <p className="text-xs text-indigo-400 text-center py-2">Drop here to ungroup</p>
            )}
          </div>

          {/* Meal groups */}
          {meals.map(meal => {
            const mealItems = lineItems.filter(i => i.meal_local_id === meal.local_id)
            const isDragTarget = dragOverTarget === meal.local_id && !!draggingItemId
            return (
              <div
                key={meal.local_id}
                className={`mt-3 border rounded-xl overflow-hidden transition-colors ${isDragTarget ? 'ring-2 ring-indigo-300 border-indigo-300' : 'border-gray-200'}`}
              >
                {/* Meal header */}
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
                  <input
                    type="text"
                    value={meal.name}
                    onChange={e => updateMeal(meal.local_id, e.target.value)}
                    placeholder="Meal name (e.g. Dinner)"
                    className={`flex-1 bg-transparent text-sm font-semibold text-gray-700 border-none outline-none focus:outline-none ${errors[`meal-${meal.local_id}`] ? 'placeholder-red-400' : 'placeholder-gray-400'}`}
                  />
                  {errors[`meal-${meal.local_id}`] && (
                    <span className="text-xs text-red-500">{errors[`meal-${meal.local_id}`]}</span>
                  )}
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
                  className={`p-2 space-y-2 min-h-[3rem] transition-colors ${isDragTarget ? 'bg-indigo-50' : 'bg-white'}`}
                  onDragOver={e => handleDragOver(e, meal.local_id)}
                  onDrop={e => handleDrop(e, meal.local_id)}
                >
                  {mealItems.map(item => renderItemRow(item))}
                  {isDragTarget && mealItems.length === 0 && (
                    <p className="text-xs text-indigo-400 text-center py-2">Drop here</p>
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
                    className="text-xs text-indigo-500 hover:text-indigo-700 transition"
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
            className="mt-3 w-full py-2 border border-dashed border-gray-300 text-sm text-gray-500 rounded-xl hover:border-indigo-300 hover:text-indigo-500 transition"
          >
            + Add Meal Group
          </button>
        </div>

        {/* Tip & Tax */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Tip</label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-gray-400 text-sm">$</span>
              <input
                type="number" min="0" step="0.01"
                value={tip}
                onChange={e => { markDirty(); setTip(e.target.value) }}
                placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg pl-6 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Tax</label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-gray-400 text-sm">$</span>
              <input
                type="number" min="0" step="0.01"
                value={tax}
                onChange={e => { markDirty(); setTax(e.target.value) }}
                placeholder="0.00"
                className="w-full border border-gray-300 rounded-lg pl-6 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          </div>
        </div>

        {/* Total preview */}
        {(() => {
          const itemsTotal = filledItems().reduce((s, i) => s + (parseFloat(i.price) || 0), 0)
          const tipAmt = parseFloat(tip) || 0
          const taxAmt = parseFloat(tax) || 0
          const grandTotal = itemsTotal + tipAmt + taxAmt
          return (
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Receipt total</span>
                <span className="font-semibold text-gray-900">${grandTotal.toFixed(2)}</span>
              </div>
              {(tipAmt > 0 || taxAmt > 0) && (
                <p className="text-xs text-gray-400 mt-0.5 text-right">
                  ${itemsTotal.toFixed(2)} items
                  {tipAmt > 0 && ` + $${tipAmt.toFixed(2)} tip`}
                  {taxAmt > 0 && ` + $${taxAmt.toFixed(2)} tax`}
                </p>
              )}
            </div>
          )
        })()}

        <button
          type="submit"
          disabled={saving}
          className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition disabled:opacity-50"
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
  )
}
