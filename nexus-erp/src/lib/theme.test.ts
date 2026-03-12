import { describe, it, expect } from 'vitest'
import { getTheme, THEMES, type ThemeId } from './theme'

// ---------------------------------------------------------------------------
// THEMES array — completeness
// ---------------------------------------------------------------------------

describe('THEMES', () => {
  const EXPECTED_IDS: ThemeId[] = ['light', 'dark', 'system', 'nexus-light-pro', 'nexus-dark-pro']

  it('should contain exactly 5 entries', () => {
    expect(THEMES).toHaveLength(5)
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
  it('should return a MUI Theme object for "light"', () => {
    const t = getTheme('light')
    expect(t).toBeDefined()
    expect(t.palette.mode).toBe('light')
  })

  it('should return a MUI Theme object for "dark"', () => {
    const t = getTheme('dark')
    expect(t).toBeDefined()
    expect(t.palette.mode).toBe('dark')
  })

  it('should return the light-palette SSR fallback for "system"', () => {
    const t = getTheme('system')
    expect(t).toBeDefined()
    expect(t.palette.mode).toBe('light')
  })

  it('should return a MUI Theme object for "nexus-light-pro"', () => {
    const t = getTheme('nexus-light-pro')
    expect(t).toBeDefined()
    expect(t.palette.mode).toBe('light')
  })

  it('should return a MUI Theme object for "nexus-dark-pro"', () => {
    const t = getTheme('nexus-dark-pro')
    expect(t).toBeDefined()
    expect(t.palette.mode).toBe('dark')
  })

  it('should return distinct theme objects for "light" and "dark"', () => {
    expect(getTheme('light')).not.toBe(getTheme('dark'))
  })

  it('should return distinct theme objects for "nexus-light-pro" and "nexus-dark-pro"', () => {
    expect(getTheme('nexus-light-pro')).not.toBe(getTheme('nexus-dark-pro'))
  })

  it('should use indigo (#4F46E5) as the primary for "light"', () => {
    expect(getTheme('light').palette.primary.main).toBe('#4F46E5')
  })

  it('should use indigo-200 (#818CF8) as the primary for "dark"', () => {
    expect(getTheme('dark').palette.primary.main).toBe('#818CF8')
  })

  it('should use cyan (#0891B2) as the primary for "nexus-light-pro"', () => {
    expect(getTheme('nexus-light-pro').palette.primary.main).toBe('#0891B2')
  })

  it('should use sky blue (#38BDF8) as the primary for "nexus-dark-pro"', () => {
    expect(getTheme('nexus-dark-pro').palette.primary.main).toBe('#38BDF8')
  })

  it('should fall back to the light theme for an unknown string ID', () => {
    const t = getTheme('not-a-real-theme')
    expect(t).toBeDefined()
    expect(t.palette.mode).toBe('light')
  })

  it('should fall back to the light theme when called with null', () => {
    const t = getTheme(null)
    expect(t).toBeDefined()
    expect(t.palette.mode).toBe('light')
  })

  it('should fall back to the light theme when called with undefined', () => {
    const t = getTheme(undefined)
    expect(t).toBeDefined()
    expect(t.palette.mode).toBe('light')
  })

  it('should fall back to the light theme when called with an empty string', () => {
    const t = getTheme('')
    expect(t).toBeDefined()
    expect(t.palette.mode).toBe('light')
  })

  it('should include Inter as the primary font family for every theme', () => {
    const ids: ThemeId[] = ['light', 'dark', 'system', 'nexus-light-pro', 'nexus-dark-pro']
    for (const id of ids) {
      expect(getTheme(id).typography.fontFamily).toContain('Inter')
    }
  })

  it('should return the same object reference on repeated calls with the same ID', () => {
    expect(getTheme('light')).toBe(getTheme('light'))
    expect(getTheme('dark')).toBe(getTheme('dark'))
    expect(getTheme('nexus-light-pro')).toBe(getTheme('nexus-light-pro'))
    expect(getTheme('nexus-dark-pro')).toBe(getTheme('nexus-dark-pro'))
  })
})
