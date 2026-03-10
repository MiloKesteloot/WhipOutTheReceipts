import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

// dbId: the real Supabase item id if loaded from DB, null if newly added
function newItem(dbId = null) {
  return { id: crypto.randomUUID(), dbId, name: '', price: '' }
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
  // Track which dbIds existed on load so we can detect deletions
  const [originalDbIds, setOriginalDbIds] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [isDirty, setIsDirty] = useState(false)
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
        }

        const { data: existingItems } = await supabase
          .from('items').select('*').eq('receipt_id', receiptId).order('created_at')
        const loaded = (existingItems || []).map(item => ({
          id: crypto.randomUUID(),
          dbId: item.id,       // preserve original DB id
          name: item.name,
          price: String(item.price),
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

  function updateItem(index, field, value) {
    markDirty()
    setLineItems(prev => {
      const next = prev.map((item, i) => i === index ? { ...item, [field]: value } : item)
      if (index === prev.length - 1) {
        const last = next[next.length - 1]
        if (last.name.trim() || last.price !== '') {
          return [...next, newItem()]
        }
      }
      return next
    })
  }

  function removeItem(index) {
    markDirty()
    setLineItems(prev => {
      const next = prev.filter((_, i) => i !== index)
      return next.length > 0 ? next : [newItem()]
    })
  }

  function filledItems() {
    return lineItems.filter(item => item.name.trim() || item.price !== '')
  }

  function validate() {
    const errs = {}
    if (!storeName.trim()) errs.storeName = 'Store name is required.'
    if (!paidBy.trim()) errs.paidBy = 'Payer name is required.'
    if (filledItems().length === 0) errs.items = 'Add at least one item.'
    filledItems().forEach((item, i) => {
      if (!item.name.trim()) errs[`name-${i}`] = 'Required'
      const p = parseFloat(item.price)
      if (isNaN(p) || p < 0) errs[`price-${i}`] = 'Invalid'
    })
    return errs
  }

  async function handleSave(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) { setErrors(errs); return }

    setSaving(true)

    if (isEditing) {
      // Update receipt metadata
      const { error: updateErr } = await supabase
        .from('receipts')
        .update({ store_name: storeName.trim(), paid_by: paidBy.trim() })
        .eq('id', receiptId)
      if (updateErr) { alert('Error updating receipt: ' + updateErr.message); setSaving(false); return }

      const filled = filledItems()

      // Update existing items in-place (preserves their claims)
      const toUpdate = filled.filter(i => i.dbId)
      for (const item of toUpdate) {
        await supabase.from('items')
          .update({ name: item.name.trim(), price: parseFloat(item.price) })
          .eq('id', item.dbId)
      }

      // Insert brand-new items
      const toInsert = filled.filter(i => !i.dbId)
      if (toInsert.length > 0) {
        await supabase.from('items').insert(
          toInsert.map(item => ({
            receipt_id: receiptId,
            name: item.name.trim(),
            price: parseFloat(item.price),
          }))
        )
      }

      // Delete only items that were removed (cascades their claims)
      const survivingDbIds = new Set(toUpdate.map(i => i.dbId))
      const toDelete = [...originalDbIds].filter(id => !survivingDbIds.has(id))
      if (toDelete.length > 0) {
        await supabase.from('items').delete().in('id', toDelete)
      }
    } else {
      const { data: receipt, error: receiptErr } = await supabase
        .from('receipts')
        .insert({ trip_id: tripId, store_name: storeName.trim(), paid_by: paidBy.trim() })
        .select()
        .single()
      if (receiptErr) { alert('Error saving receipt: ' + receiptErr.message); setSaving(false); return }

      const { error: itemsErr } = await supabase.from('items').insert(
        filledItems().map(item => ({
          receipt_id: receipt.id,
          name: item.name.trim(),
          price: parseFloat(item.price),
        }))
      )
      if (itemsErr) { alert('Error saving items: ' + itemsErr.message); setSaving(false); return }
    }

    navigate(`/trip/${tripId}`)
  }

  if (trip?.closed) {
    return (
      <div className="max-w-xl mx-auto p-8 text-center text-gray-500">
        This trip is closed.{' '}
        <button onClick={handleBack} className="text-indigo-500 underline">Go back</button>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto p-4 py-8">
      <button onClick={handleBack} className="text-sm text-indigo-500 hover:underline mb-2 inline-block">
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
          <label className="block text-sm font-medium text-gray-700 mb-2">Items</label>
          {errors.items && <p className="text-xs text-red-500 mb-2">{errors.items}</p>}
          <div className="space-y-2">
            {lineItems.map((item, i) => (
              <div key={item.id} className="flex gap-2 items-start">
                <div className="flex-1">
                  <input
                    type="text"
                    value={item.name}
                    onChange={e => { updateItem(i, 'name', e.target.value); setErrors(v => ({ ...v, [`name-${i}`]: undefined })) }}
                    placeholder="Item name"
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 ${errors[`name-${i}`] ? 'border-red-400' : 'border-gray-300'}`}
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
                      onChange={e => { updateItem(i, 'price', e.target.value); setErrors(v => ({ ...v, [`price-${i}`]: undefined })) }}
                      placeholder="0.00"
                      className={`w-full border rounded-lg pl-6 pr-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 ${errors[`price-${i}`] ? 'border-red-400' : 'border-gray-300'}`}
                    />
                  </div>
                </div>
                {lineItems.length > 1 && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => removeItem(i)}
                    className="mt-2 text-gray-400 hover:text-red-500 transition text-sm"
                    aria-label="Remove item"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Total preview */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex justify-between items-center">
          <span className="text-sm text-gray-500">Receipt total</span>
          <span className="font-semibold text-gray-900">
            ${filledItems().reduce((s, i) => s + (parseFloat(i.price) || 0), 0).toFixed(2)}
          </span>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition disabled:opacity-50"
        >
          {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Save Receipt'}
        </button>
      </form>
    </div>
  )
}
