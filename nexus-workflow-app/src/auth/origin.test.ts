import { describe, it, expect } from 'vitest'
import { normalizeOrigin } from './origin.js'

describe('normalizeOrigin', () => {
  it('treats an unset or empty value as "not configured"', () => {
    expect(normalizeOrigin(undefined)).toEqual({ ok: true, origin: undefined })
    expect(normalizeOrigin('')).toEqual({ ok: true, origin: undefined })
    expect(normalizeOrigin('   ')).toEqual({ ok: true, origin: undefined })
  })

  it.each([
    ['https://workflow.example.com', 'https://workflow.example.com'],
    ['https://workflow.example.com/', 'https://workflow.example.com'],
    ['  https://workflow.example.com/  ', 'https://workflow.example.com'],
    ['HTTPS://Workflow.Example.COM', 'https://workflow.example.com'],
    ['https://workflow.example.com:443', 'https://workflow.example.com'],
    ['http://localhost:3000/', 'http://localhost:3000'],
    ['https://workflow.example.com/console/', 'https://workflow.example.com'],
    ['https://workflow.example.com/?a=1#x', 'https://workflow.example.com'],
  ])('normalizes %j to the exact form a browser sends in the Origin header: %j', (input, expected) => {
    expect(normalizeOrigin(input)).toEqual({ ok: true, origin: expected })
  })

  it.each(['workflow.example.com', 'not a url', 'ftp://workflow.example.com', 'javascript:alert(1)', '//workflow.example.com', 'https://user:secret@workflow.example.com'])(
    'rejects %j, so a typo fails at startup instead of silently breaking every sign-in',
    (input) => {
      expect(normalizeOrigin(input)).toEqual({ ok: false })
    },
  )
})
