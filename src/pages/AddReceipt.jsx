import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

function newItem() {
  return { id: crypto.randomUUID(), name: '', price: '' }
}

export default function AddReceipt() {
  const { id: tripId } = useParams()
  const navigate = useNavigate()

  const [trip, setTrip] = useState(null)
  const [storeName, setStoreName] = useState('')
  const [paidBy, setPaidBy] = useState('')
  const [knownNames, setKnownNames] = useState([])
  const [lineItems, setLineItems] = useState([newItem()])
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    async function load() {
      const { data: tripData } = await supabase.from('trips').select('*').eq('id', tripId).single()
      setTrip(tripData)

      // Gather known names from existing receipts and claims
      const { data: receipts } = await supabase.from('receipts').select('paid_by').eq('trip_id', tripId)
      const { data: claimsRaw } = await supabase
        .from('claims')
        .select('roommate, items(receipt_id, receipts(trip_id))')

      const names = new Set((receipts || []).map(r => r.paid_by))
      setKnownNames([...names].filter(Boolean))

      // Pre-fill paidBy from localStorage name
      const saved = localStorage.getItem(`trip-name-${tripId}`)
      if (saved) setPaidBy(saved)
    }
    load()
  }, [tripId])

  function updateItem(index, field, value) {
    setLineItems(prev => {
      const next = prev.map((item, i) => i === index ? { ...item, [field]: value } : item)
      // Auto-append a new empty row when the last item gets content
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
    setLineItems(prev => {
      const next = prev.filter((_, i) => i !== index)
      // Always keep at least one row
      return next.length > 0 ? next : [newItem()]
    })
  }

  // Items with at least a name or price filled in
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

    navigate(`/trip/${tripId}`)
  }

  if (trip?.closed) {
    return (
      <div className="max-w-xl mx-auto p-8 text-center text-gray-500">
        This trip is closed. <Link to={`/trip/${tripId}`} className="text-indigo-500 underline">Go back</Link>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto p-4 py-8">
      <Link to={`/trip/${tripId}`} className="text-sm text-indigo-500 hover:underline mb-2 inline-block">
        ← Back to trip
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Add Receipt</h1>

      <form onSubmit={handleSave} className="space-y-5">
        {/* Store name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Store name</label>
          <input
            type="text"
            value={storeName}
            onChange={e => { setStoreName(e.target.value); setErrors(v => ({ ...v, storeName: undefined })) }}
            placeholder="e.g. Costco"
            className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${errors.storeName ? 'border-red-400' : 'border-gray-300'}`}
            autoFocus
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
            onChange={e => { setPaidBy(e.target.value); setErrors(v => ({ ...v, paidBy: undefined })) }}
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
          {saving ? 'Saving…' : 'Save Receipt'}
        </button>
      </form>
    </div>
  )
}
