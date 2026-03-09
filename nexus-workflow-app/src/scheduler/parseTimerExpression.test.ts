import { describe, it, expect } from 'vitest'
import { parseTimerExpression } from './parseTimerExpression.js'

const BASE = new Date('2025-01-01T00:00:00.000Z')

describe('parseTimerExpression', () => {
  describe('ISO 8601 datetime', () => {
    it('parses a UTC datetime string', () => {
      const result = parseTimerExpression('2025-06-15T09:30:00Z', BASE)
      expect(result).toEqual(new Date('2025-06-15T09:30:00Z'))
    })

    it('parses a datetime with milliseconds', () => {
      const result = parseTimerExpression('2025-03-10T12:00:00.500Z', BASE)
      expect(result).toEqual(new Date('2025-03-10T12:00:00.500Z'))
    })
  })

  describe('ISO 8601 duration', () => {
    it('PT30S — 30 seconds from base', () => {
      const result = parseTimerExpression('PT30S', BASE)
      expect(result.getTime()).toBe(BASE.getTime() + 30 * 1000)
    })

    it('PT5M — 5 minutes from base', () => {
      const result = parseTimerExpression('PT5M', BASE)
      expect(result.getTime()).toBe(BASE.getTime() + 5 * 60 * 1000)
    })

    it('PT1H — 1 hour from base', () => {
      const result = parseTimerExpression('PT1H', BASE)
      expect(result.getTime()).toBe(BASE.getTime() + 3600 * 1000)
    })

    it('P1D — 1 day from base', () => {
      const result = parseTimerExpression('P1D', BASE)
      expect(result.getTime()).toBe(BASE.getTime() + 24 * 3600 * 1000)
    })

    it('P1W — 1 week from base', () => {
      const result = parseTimerExpression('P1W', BASE)
      expect(result.getTime()).toBe(BASE.getTime() + 7 * 24 * 3600 * 1000)
    })

    it('PT1H30M — 1 hour 30 minutes from base', () => {
      const result = parseTimerExpression('PT1H30M', BASE)
      expect(result.getTime()).toBe(BASE.getTime() + (90 * 60 * 1000))
    })

    it('P1DT2H — 1 day 2 hours from base', () => {
      const result = parseTimerExpression('P1DT2H', BASE)
      expect(result.getTime()).toBe(BASE.getTime() + (26 * 3600 * 1000))
    })

    it('PT0.5S — half second from base', () => {
      const result = parseTimerExpression('PT0.5S', BASE)
      expect(result.getTime()).toBe(BASE.getTime() + 500)
    })

    it('whitespace around expression is trimmed', () => {
      const result = parseTimerExpression('  PT10S  ', BASE)
      expect(result.getTime()).toBe(BASE.getTime() + 10 * 1000)
    })
  })

  describe('invalid expressions', () => {
    it('throws for an unrecognised string', () => {
      expect(() => parseTimerExpression('not-a-timer', BASE)).toThrow()
    })

    it('throws for an empty string', () => {
      expect(() => parseTimerExpression('', BASE)).toThrow()
    })
  })
})
