import { describe, it, expect } from 'vitest'
import { nameClash, computeDisplayNames } from './names.js'

const person = (first_name, last_name = '', extra = {}) => ({ first_name, last_name, ...extra })

describe('nameClash', () => {
  it('is fine when nobody has your first name', () => {
    expect(nameClash(person('Sam'), [person('Alex'), person('Milo', 'K')])).toBeNull()
  })

  it('asks for a last name when your first name is taken and you have none', () => {
    expect(nameClash(person('alex'), [person('Alex', 'Kim')])).toBe('needs_last')
    expect(nameClash(person('Alex', '  '), [person('Alex')])).toBe('needs_last')
  })

  it('is fine with a different last name', () => {
    expect(nameClash(person('Alex', 'Moore'), [person('Alex', 'Kim')])).toBeNull()
    expect(nameClash(person('Alex', 'Moore'), [person('Alex')])).toBeNull()
  })

  it('flags an exact same full name', () => {
    expect(nameClash(person('Alex', 'kim'), [person('ALEX', 'Kim ')])).toBe('same_name')
  })

  it('ignores people who left the group', () => {
    expect(nameClash(person('Alex'), [person('Alex', '', { active: false })])).toBeNull()
  })
})

// The rule above exists so the group's display names never need numbering
describe('display names after a name check', () => {
  const withIds = list => list.map((m, i) => ({ id: String(i), created_at: String(i), ...m }))

  it('tells apart people the check lets through', () => {
    const names = computeDisplayNames(withIds([person('Alex', 'Kim'), person('Alex', 'Moore'), person('Sam')]))
    expect([...names.values()].sort()).toEqual(['Alex K.', 'Alex M.', 'Sam'])
  })

  it('falls back to numbers only for clashes the check would block', () => {
    const names = computeDisplayNames(withIds([person('Alex'), person('Alex')]))
    expect([...names.values()]).toEqual(['Alex', 'Alex (2)'])
  })
})
