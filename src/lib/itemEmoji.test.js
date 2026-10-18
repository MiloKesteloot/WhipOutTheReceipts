import { describe, it, expect } from 'vitest'
import { getItemEmoji } from './itemEmoji.js'

describe('getItemEmoji', () => {
  it.each([
    ['Salad kit', '🥗'],
    ['Toilet paper', '🧻'],
    ['Aluminum foil', '🗑️'],
    ['Shampoo', '🧴'],
    ['Champagne', '🍷'],
    ['Pepperoni', '🌭'],
    ['Pepperoni Pizza', '🍕'],
    ['Black pepper', '🧂'],
    ['Jalapeño peppers', '🌶️'],
    ['Popcorn', '🍿'],
    ['Corn tortillas', '🌽'],
    ['Chocolate chip cookies', '🍪'],
    ['Chocolate chips', '🍫'],
    ['Tortilla chips', '🫓'],
    ['Olive oil', '🫙'],
    ['Watermelon', '🍉'],
    ['Strawberries', '🍓'],
  ])('%s → %s', (name, emoji) => {
    expect(getItemEmoji(name)).toBe(emoji)
  })

  it('returns null for unknown items', () => {
    expect(getItemEmoji('Mystery box')).toBeNull()
    expect(getItemEmoji('')).toBeNull()
  })
})
