import { describe, it, expect } from 'vitest'
import { THEMES, getTheme, theme } from './theme'

describe('THEMES', () => {
  it('has three entries with the expected ids', () => {
    const ids = THEMES.map((t) => t.id)
    expect(ids).toEqual(['default', 'nexus-premium-light', 'nexus-premium-dark'])
  })

  it('each entry has an id, label, and swatch array', () => {
    for (const entry of THEMES) {
      expect(typeof entry.label).toBe('string')
      expect(Array.isArray(entry.swatch)).toBe(true)
      expect(entry.swatch.length).toBe(3)
    }
  })
})

describe('getTheme', () => {
  it('returns the correct theme for "nexus-premium-light"', () => {
    const t = getTheme('nexus-premium-light')
    expect(t.palette.primary.main).toBe('#0F766E')
  })

  it('returns the correct theme for "nexus-premium-dark"', () => {
    const t = getTheme('nexus-premium-dark')
    expect(t.palette.mode).toBe('dark')
  })

  it('returns the default theme for an unknown id', () => {
    const t = getTheme('not-a-real-theme')
    expect(t.palette.primary.main).toBe('#3D4FB5')
  })

  it('returns the default theme for null', () => {
    const t = getTheme(null)
    expect(t.palette.primary.main).toBe('#3D4FB5')
  })

  it('returns the default theme for undefined', () => {
    const t = getTheme(undefined)
    expect(t.palette.primary.main).toBe('#3D4FB5')
  })
})

describe('theme (backward-compat default export)', () => {
  it('is the default theme', () => {
    expect(theme.palette.primary.main).toBe('#3D4FB5')
    expect(theme.palette.mode).toBe('light')
  })
})
