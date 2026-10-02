import { describe, it, expect } from 'vitest'
import { normalizeEmail } from './email.js'

describe('normalizeEmail', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('  Jo.Langlois@Example.COM ')).toBe('jo.langlois@example.com')
  })

  it.each(['', '   ', 'no-at-sign', '@example.com', 'user@', 'a@b@c.com', 'two words@example.com', 'user@exa mple.com', 'a'.repeat(250) + '@x.io'])(
    'rejects %j',
    (value) => {
      expect(normalizeEmail(value)).toBeNull()
    },
  )

  it('accepts plus-addressing and subdomains', () => {
    expect(normalizeEmail('me+workflow@mail.example.co.uk')).toBe('me+workflow@mail.example.co.uk')
  })
})
