import { describe, it, expect } from 'vitest'
import { getTheme, THEMES, type ThemeId } from './theme'

// ---------------------------------------------------------------------------
// THEMES array — completeness
// ---------------------------------------------------------------------------

describe('THEMES', () => {
  const EXPECTED_IDS: ThemeId[] = ['default', 'nexus-premium-light', 'nexus-premium-dark']

  it('should contain exactly 3 entries', () => {
    expect(THEMES).toHaveLength(3)
  })

  it('should contain an entry for every ThemeId', () => {
    const ids = THEMES.map((t) => t.id)
    for (const id of EXPECTED_IDS) {
      expect(ids).toContain(id)
    }
  })

  it('should expose a non-empty label for every entry', () => {
    for (const entry of THEMES) {
      expect(typeof entry.label).toBe('string')
      expect(entry.label.length).toBeGreaterThan(0)
    }
  })

  it('should expose a swatch array with at least one colour for every entry', () => {
    for (const entry of THEMES) {
      expect(Array.isArray(entry.swatch)).toBe(true)
      expect(entry.swatch.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// getTheme — happy paths (all valid IDs)
// ---------------------------------------------------------------------------

describe('getTheme', () => {
  it('should return a MUI Theme object for "default"', () => {
    const t = getTheme('default')
    expect(t).toBeDefined()
    expect(t.palette.mode).toBe('light')
  })

  it('should return a MUI Theme object for "nexus-premium-light"', () => {
    const t = getTheme('nexus-premium-light')
    expect(t).toBeDefined()
    expect(t.palette.mode).toBe('light')
  })

  it('should return a MUI Theme object for "nexus-premium-dark"', () => {
    const t = getTheme('nexus-premium-dark')
    expect(t).toBeDefined()
    expect(t.palette.mode).toBe('dark')
  })

  it('should return distinct theme objects for "default" and "nexus-premium-light"', () => {
    expect(getTheme('default')).not.toBe(getTheme('nexus-premium-light'))
  })

  it('should return distinct theme objects for "nexus-premium-light" and "nexus-premium-dark"', () => {
    expect(getTheme('nexus-premium-light')).not.toBe(getTheme('nexus-premium-dark'))
  })

  it('should use indigo-navy (#3D4FB5) as the primary for "default"', () => {
    expect(getTheme('default').palette.primary.main).toBe('#3D4FB5')
  })

  it('should use forest teal (#0F766E) as the primary for "nexus-premium-light"', () => {
    expect(getTheme('nexus-premium-light').palette.primary.main).toBe('#0F766E')
  })

  it('should use teal-cyan (#00B4D8) as the primary for "nexus-premium-dark"', () => {
    expect(getTheme('nexus-premium-dark').palette.primary.main).toBe('#00B4D8')
  })

  it('should fall back to the default theme for an unknown string ID', () => {
    const t = getTheme('not-a-real-theme')
    expect(t).toBeDefined()
    expect(t.palette.mode).toBe('light')
  })

  it('should fall back to the default theme when called with null', () => {
    const t = getTheme(null)
    expect(t).toBeDefined()
    expect(t.palette.mode).toBe('light')
  })

  it('should fall back to the default theme when called with undefined', () => {
    const t = getTheme(undefined)
    expect(t).toBeDefined()
    expect(t.palette.mode).toBe('light')
  })

  it('should fall back to the default theme when called with an empty string', () => {
    const t = getTheme('')
    expect(t).toBeDefined()
    expect(t.palette.mode).toBe('light')
  })

  it('should include Inter as the primary font family for every theme', () => {
    const ids: ThemeId[] = ['default', 'nexus-premium-light', 'nexus-premium-dark']
    for (const id of ids) {
      expect(getTheme(id).typography.fontFamily).toContain('Inter')
    }
  })

  it('should return the same object reference on repeated calls with the same ID', () => {
    expect(getTheme('default')).toBe(getTheme('default'))
    expect(getTheme('nexus-premium-light')).toBe(getTheme('nexus-premium-light'))
    expect(getTheme('nexus-premium-dark')).toBe(getTheme('nexus-premium-dark'))
  })
})
