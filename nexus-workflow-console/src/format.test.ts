import { describe, it, expect } from 'vitest'
import { formatDuration } from './format'

describe('formatDuration', () => {
  it.each([
    [0, '0 ms'],
    [42, '42 ms'],
    [999, '999 ms'],
    [1000, '1 s'],
    [3500, '3.5 s'],
    [59_000, '59 s'],
    [60_000, '1 min'],
    [125_000, '2 min 5 s'],
    [3_599_000, '59 min 59 s'],
    [3_600_000, '1 h'],
    [3_840_000, '1 h 4 min'],
    [26 * 3_600_000, '26 h'],
  ])('%i ms is %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text)
  })

  it('does not make a number up for a time that makes no sense', () => {
    expect(formatDuration(-5)).toBe('—')
    expect(formatDuration(Number.NaN)).toBe('—')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—')
  })

  it('rolls 59 min 30 s or more up to the next hour rather than printing 60 min', () => {
    expect(formatDuration(3_599_700)).toBe('1 h')
    expect(formatDuration(7_170_000)).toBe('2 h')
  })
})
