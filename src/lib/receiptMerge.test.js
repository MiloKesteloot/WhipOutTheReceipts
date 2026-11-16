import { describe, it, expect } from 'vitest'
import { merge3, toSaveData, fromDb } from './receiptMerge.js'

// A receipt to edit: Milk, Bread, Pasta (in Dinner), Cake (in Dessert)
const base = () => ({
  fields: { store_name: 'Safeway', paid_by_member: 'milo', category: 'Groceries', tip: 0, tax: 1.5, fees: 0, receipt_date: '2026-10-23' },
  member_ids: ['milo', 'alex', 'niko'],
  meals: [
    { id: 'dinner', key: 'dinner', name: 'Dinner', fee: 2 },
    { id: 'dessert', key: 'dessert', name: 'Dessert', fee: 0 },
  ],
  items: [
    { id: 'milk', key: 'milk', name: 'Milk', price: 5.49, always_split: false, meal: null, meal_key: null },
    { id: 'bread', key: 'bread', name: 'Bread', price: 3, always_split: false, meal: null, meal_key: null },
    { id: 'pasta', key: 'pasta', name: 'Pasta', price: 8, always_split: false, meal: 'dinner', meal_key: null },
    { id: 'cake', key: 'cake', name: 'Cake', price: 6, always_split: false, meal: 'dessert', meal_key: null },
  ],
})
const edit = (r, fn) => { const copy = structuredClone(r); fn(copy); return copy }
const item = (r, id) => r.items.find(i => i.id === id)
const names = r => r.items.map(i => i.name)

describe('merging two edits of a receipt', () => {
  it('nobody changed anything: same receipt, no questions', () => {
    const { result, conflicts } = merge3(base(), base(), base())
    expect(conflicts).toEqual([])
    expect(result).toEqual(base())
  })

  it('only they changed it: their version', () => {
    const theirs = edit(base(), r => { r.fields.store_name = 'Safeway #2'; item(r, 'milk').price = 4.99 })
    const { result, conflicts } = merge3(base(), base(), theirs)
    expect(conflicts).toEqual([])
    expect(result.fields.store_name).toBe('Safeway #2')
    expect(item(result, 'milk').price).toBe(4.99)
  })

  it('only I changed it: my version', () => {
    const mine = edit(base(), r => { r.fields.tax = 2; item(r, 'bread').name = 'Sourdough' })
    const { result, conflicts } = merge3(base(), mine, base())
    expect(conflicts).toEqual([])
    expect(result.fields.tax).toBe(2)
    expect(item(result, 'bread').name).toBe('Sourdough')
  })

  it('different things changed: both are kept', () => {
    const mine = edit(base(), r => { item(r, 'milk').price = 4.99; r.fields.tip = 3 })
    const theirs = edit(base(), r => { item(r, 'bread').name = 'Sourdough'; r.fields.tax = 2 })
    const { result, conflicts } = merge3(base(), mine, theirs)
    expect(conflicts).toEqual([])
    expect(item(result, 'milk').price).toBe(4.99)
    expect(item(result, 'bread').name).toBe('Sourdough')
    expect(result.fields).toMatchObject({ tip: 3, tax: 2 })
  })

  it('different fields of the same item: both are kept', () => {
    const mine = edit(base(), r => { item(r, 'milk').price = 4.99 })
    const theirs = edit(base(), r => { item(r, 'milk').name = 'Oat milk' })
    const { result, conflicts } = merge3(base(), mine, theirs)
    expect(conflicts).toEqual([])
    expect(item(result, 'milk')).toMatchObject({ name: 'Oat milk', price: 4.99 })
  })

  it('the same change on both sides is not a conflict', () => {
    const mine = edit(base(), r => { item(r, 'milk').price = 4.99 })
    const theirs = edit(base(), r => { item(r, 'milk').price = '4.990' })
    const { result, conflicts } = merge3(base(), mine, theirs)
    expect(conflicts).toEqual([])
    expect(item(result, 'milk').price).toBe(4.99)
  })

  it('the same item price changed differently: asks, and takes the choice', () => {
    const mine = edit(base(), r => { item(r, 'milk').price = 5.29 })
    const theirs = edit(base(), r => { item(r, 'milk').price = 4.99 })
    const first = merge3(base(), mine, theirs)
    expect(first.conflicts).toEqual([
      { key: 'item:milk:price', kind: 'item', field: 'price', label: 'Milk', mine: 5.29, theirs: 4.99 },
    ])
    expect(item(merge3(base(), mine, theirs, { 'item:milk:price': 'mine' }).result, 'milk').price).toBe(5.29)
    expect(item(merge3(base(), mine, theirs, { 'item:milk:price': 'theirs' }).result, 'milk').price).toBe(4.99)
  })

  it('a receipt field changed differently: asks', () => {
    const mine = edit(base(), r => { r.fields.store_name = 'Safeway Downtown' })
    const theirs = edit(base(), r => { r.fields.store_name = 'Safeway Uptown' })
    const { conflicts } = merge3(base(), mine, theirs)
    expect(conflicts.map(c => c.key)).toEqual(['field:store_name'])
    expect(merge3(base(), mine, theirs, { 'field:store_name': 'mine' }).result.fields.store_name).toBe('Safeway Downtown')
  })

  it('whitespace and number formatting are not changes', () => {
    const mine = edit(base(), r => { r.fields.store_name = ' Safeway '; r.fields.tax = '1.50'; item(r, 'bread').price = '3' })
    const theirs = edit(base(), r => { item(r, 'bread').name = 'Sourdough' })
    const { result, conflicts } = merge3(base(), mine, theirs)
    expect(conflicts).toEqual([])
    expect(item(result, 'bread').name).toBe('Sourdough')
  })

  describe('items added', () => {
    it('items added on both sides are all kept', () => {
      const mine = edit(base(), r => { r.items.push({ id: null, key: 'k1', name: 'Eggs', price: 4, always_split: false, meal: null, meal_key: null }) })
      const theirs = edit(base(), r => { r.items.push({ id: 'juice', key: 'juice', name: 'Juice', price: 3, always_split: false, meal: null, meal_key: null }) })
      const { result, conflicts } = merge3(base(), mine, theirs)
      expect(conflicts).toEqual([])
      // Mine goes right after the item it followed (Cake)
      expect(names(result)).toEqual(['Milk', 'Bread', 'Pasta', 'Cake', 'Eggs', 'Juice'])
    })

    it('an item I added in the middle stays where I put it', () => {
      const mine = edit(base(), r => { r.items.splice(1, 0, { id: null, key: 'k1', name: 'Eggs', price: 4, always_split: false, meal: null, meal_key: null }) })
      const theirs = edit(base(), r => { item(r, 'cake').price = 7 })
      expect(names(merge3(base(), mine, theirs).result)).toEqual(['Milk', 'Eggs', 'Bread', 'Pasta', 'Cake'])
    })

    it('an item I added first stays first', () => {
      const mine = edit(base(), r => { r.items.unshift({ id: null, key: 'k1', name: 'Eggs', price: 4, always_split: false, meal: null, meal_key: null }) })
      expect(names(merge3(base(), mine, base()).result)[0]).toBe('Eggs')
    })

    it('two items with the same name added on both sides are both kept (they may be two things)', () => {
      const mine = edit(base(), r => { r.items.push({ id: null, key: 'k1', name: 'Eggs', price: 4, always_split: false, meal: null, meal_key: null }) })
      const theirs = edit(base(), r => { r.items.push({ id: 'eggs2', key: 'eggs2', name: 'Eggs', price: 4, always_split: false, meal: null, meal_key: null }) })
      expect(merge3(base(), mine, theirs).result.items.filter(i => i.name === 'Eggs')).toHaveLength(2)
    })
  })

  describe('items removed', () => {
    it('removed by me, untouched by them: gone', () => {
      const mine = edit(base(), r => { r.items = r.items.filter(i => i.id !== 'bread') })
      const { result, conflicts } = merge3(base(), mine, base())
      expect(conflicts).toEqual([])
      expect(names(result)).toEqual(['Milk', 'Pasta', 'Cake'])
    })

    it('removed by them, untouched by me: gone', () => {
      const theirs = edit(base(), r => { r.items = r.items.filter(i => i.id !== 'bread') })
      const { result, conflicts } = merge3(base(), base(), theirs)
      expect(conflicts).toEqual([])
      expect(names(result)).toEqual(['Milk', 'Pasta', 'Cake'])
    })

    it('removed on both sides: gone', () => {
      const gone = edit(base(), r => { r.items = r.items.filter(i => i.id !== 'bread') })
      expect(merge3(base(), gone, gone).conflicts).toEqual([])
    })

    it('removed by me but changed by them: asks', () => {
      const mine = edit(base(), r => { r.items = r.items.filter(i => i.id !== 'bread') })
      const theirs = edit(base(), r => { item(r, 'bread').price = 3.5 })
      const { conflicts, result } = merge3(base(), mine, theirs)
      expect(conflicts).toMatchObject([{ key: 'item:bread:removed', kind: 'itemRemovedByMe', label: 'Bread' }])
      // No choice yet: theirs (kept, with their change)
      expect(item(result, 'bread').price).toBe(3.5)
      expect(names(merge3(base(), mine, theirs, { 'item:bread:removed': 'mine' }).result)).not.toContain('Bread')
    })

    it('removed by them but changed by me: asks; keeping mine adds it back as a new item', () => {
      const mine = edit(base(), r => { item(r, 'bread').price = 3.5 })
      const theirs = edit(base(), r => { r.items = r.items.filter(i => i.id !== 'bread') })
      const { conflicts, result } = merge3(base(), mine, theirs)
      expect(conflicts).toMatchObject([{ key: 'item:bread:removed', kind: 'itemRemovedByThem', label: 'Bread' }])
      expect(names(result)).not.toContain('Bread')
      const kept = merge3(base(), mine, theirs, { 'item:bread:removed': 'mine' }).result
      expect(kept.items.find(i => i.name === 'Bread')).toMatchObject({ id: null, price: 3.5 })
      // …in its place
      expect(names(kept)).toEqual(['Milk', 'Bread', 'Pasta', 'Cake'])
    })
  })

  describe('meals', () => {
    it('moving an item into a meal and someone renaming that meal: both kept', () => {
      const mine = edit(base(), r => { item(r, 'milk').meal = 'dinner' })
      const theirs = edit(base(), r => { r.meals[0].name = 'Supper' })
      const { result, conflicts } = merge3(base(), mine, theirs)
      expect(conflicts).toEqual([])
      expect(item(result, 'milk').meal).toBe('dinner')
      expect(result.meals[0].name).toBe('Supper')
    })

    it('moving an item into a new meal of mine is kept', () => {
      const mine = edit(base(), r => {
        r.meals.push({ id: null, key: 'm-new', name: 'Breakfast', fee: 0 })
        item(r, 'milk').meal_key = 'm-new'
      })
      const theirs = edit(base(), r => { item(r, 'cake').price = 7 })
      const { result, conflicts } = merge3(base(), mine, theirs)
      expect(conflicts).toEqual([])
      expect(item(result, 'milk')).toMatchObject({ meal: null, meal_key: 'm-new' })
      expect(result.meals.map(m => m.name)).toEqual(['Dinner', 'Dessert', 'Breakfast'])
    })

    it('a meal they removed takes its items out of it (the items stay)', () => {
      const theirs = edit(base(), r => { r.meals = r.meals.filter(m => m.id !== 'dessert') })
      const { result } = merge3(base(), base(), theirs)
      expect(item(result, 'cake')).toMatchObject({ meal: null })
      expect(names(result)).toContain('Cake')
    })

    it('an item I moved into a meal they removed ends up in no meal', () => {
      const mine = edit(base(), r => { item(r, 'milk').meal = 'dessert' })
      const theirs = edit(base(), r => { r.meals = r.meals.filter(m => m.id !== 'dessert') })
      expect(item(merge3(base(), mine, theirs).result, 'milk').meal).toBeNull()
    })

    it('a meal fee changed differently: asks', () => {
      const mine = edit(base(), r => { r.meals[0].fee = 3 })
      const theirs = edit(base(), r => { r.meals[0].fee = 4 })
      expect(merge3(base(), mine, theirs).conflicts.map(c => c.key)).toEqual(['meal:dinner:fee'])
    })

    it('a meal I renamed that they removed: asks', () => {
      const mine = edit(base(), r => { r.meals[1].name = 'Sweets' })
      const theirs = edit(base(), r => { r.meals = r.meals.filter(m => m.id !== 'dessert') })
      expect(merge3(base(), mine, theirs).conflicts).toMatchObject([{ kind: 'mealRemovedByThem', label: 'Sweets' }])
    })

    it('the same item moved into different meals: asks', () => {
      const mine = edit(base(), r => { item(r, 'milk').meal = 'dinner' })
      const theirs = edit(base(), r => { item(r, 'milk').meal = 'dessert' })
      expect(merge3(base(), mine, theirs).conflicts.map(c => c.key)).toEqual(['item:milk:mealRef'])
    })
  })

  describe('order', () => {
    it('my reordering is kept, with their new item placed after the item it followed', () => {
      const mine = edit(base(), r => { r.items.reverse() })
      const theirs = edit(base(), r => { r.items.push({ id: 'juice', key: 'juice', name: 'Juice', price: 3, always_split: false, meal: null, meal_key: null }) })
      expect(names(merge3(base(), mine, theirs).result)).toEqual(['Cake', 'Juice', 'Pasta', 'Bread', 'Milk'])
    })

    it('their reordering is kept when I didn\'t reorder', () => {
      const theirs = edit(base(), r => { r.items.reverse() })
      const mine = edit(base(), r => { item(r, 'milk').price = 4 })
      expect(names(merge3(base(), mine, theirs).result)).toEqual(['Cake', 'Pasta', 'Bread', 'Milk'])
    })
  })

  describe('people', () => {
    it('people added on either side are all on it', () => {
      const mine = edit(base(), r => { r.member_ids.push('clouey') })
      const theirs = edit(base(), r => { r.member_ids.push('sam') })
      expect(merge3(base(), mine, theirs).result.member_ids.sort()).toEqual(['alex', 'clouey', 'milo', 'niko', 'sam'])
    })

    it('someone taken off on either side is off', () => {
      const mine = edit(base(), r => { r.member_ids = r.member_ids.filter(id => id !== 'niko') })
      const theirs = edit(base(), r => { r.member_ids.push('sam') })
      expect(merge3(base(), mine, theirs).result.member_ids.sort()).toEqual(['alex', 'milo', 'sam'])
    })

    it('who paid changed differently: asks', () => {
      const mine = edit(base(), r => { r.fields.paid_by_member = 'alex' })
      const theirs = edit(base(), r => { r.fields.paid_by_member = 'niko' })
      expect(merge3(base(), mine, theirs).conflicts.map(c => c.key)).toEqual(['field:paid_by_member'])
    })
  })

  it('several conflicts at once are all listed, each resolved on its own', () => {
    const mine = edit(base(), r => { item(r, 'milk').price = 5.29; r.fields.tax = 2; item(r, 'bread').name = 'Rye' })
    const theirs = edit(base(), r => { item(r, 'milk').price = 4.99; r.fields.tax = 3; item(r, 'bread').name = 'Sourdough' })
    const { conflicts } = merge3(base(), mine, theirs)
    expect(conflicts.map(c => c.key).sort()).toEqual(['field:tax', 'item:bread:name', 'item:milk:price'])
    const { result } = merge3(base(), mine, theirs, { 'field:tax': 'mine', 'item:milk:price': 'theirs', 'item:bread:name': 'mine' })
    expect(result.fields.tax).toBe(2)
    expect(item(result, 'milk').price).toBe(4.99)
    expect(item(result, 'bread').name).toBe('Rye')
  })
})

describe('to and from the database', () => {
  it('fromDb orders items by position (unset last, then oldest) and meals by when they were made', () => {
    const r = fromDb(
      { store_name: 'S', paid_by_member: 'milo', category: 'Groceries', tip: 0, tax: 0, fees: 0, receipt_date: null, member_ids: ['milo'] },
      [
        { id: 'c', name: 'C', price: '1', position: null, created_at: '2026-01-02' },
        { id: 'b', name: 'B', price: '2.5', position: 1, created_at: '2026-01-01' },
        { id: 'a', name: 'A', price: '3', position: 0, created_at: '2026-01-03' },
        { id: 'd', name: 'D', price: '1', position: null, created_at: '2026-01-01' },
      ],
      [{ id: 'm2', name: 'Two', fee: '1', created_at: '2026-01-02' }, { id: 'm1', name: 'One', fee: '0', created_at: '2026-01-01' }],
    )
    expect(r.items.map(i => i.id)).toEqual(['a', 'b', 'd', 'c'])
    expect(r.items[1].price).toBe(2.5)
    expect(r.meals.map(m => m.name)).toEqual(['One', 'Two'])
  })

  it('toSaveData numbers items in order and links new meals by key', () => {
    const r = edit(base(), x => {
      x.meals.push({ id: null, key: 'm-new', name: 'Breakfast', fee: '' })
      x.items.push({ id: null, key: 'k1', name: 'Eggs', price: '4', always_split: false, meal: null, meal_key: 'm-new' })
    })
    const data = toSaveData(r)
    expect(data.items.map(i => i.position)).toEqual([0, 1, 2, 3, 4])
    expect(data.items[4]).toEqual({ id: null, name: 'Eggs', price: 4, always_split: false, meal: null, meal_key: 'm-new', position: 4 })
    expect(data.meals[2]).toEqual({ id: null, key: 'm-new', name: 'Breakfast', fee: 0 })
    expect(data.store_name).toBe('Safeway')
    expect(data.member_ids).toEqual(['milo', 'alex', 'niko'])
  })
})
