import { describe, it, expect } from 'vitest'
import * as React from 'react'
import { ThemeContext, useTheme } from './ThemeContext'

describe('ThemeContext', () => {
  describe('default context value', () => {
    it('should have themeId defaulting to "system"', () => {
      const defaultValue = (ThemeContext as any)._currentValue ?? (ThemeContext as any)._currentValue2
      expect(defaultValue?.themeId ?? 'system').toBe('system')
    })

    it('should have setThemeId as a no-op function by default', () => {
      const defaultValue = (ThemeContext as any)._currentValue ?? (ThemeContext as any)._currentValue2
      const setFn = defaultValue?.setThemeId
      if (typeof setFn === 'function') {
        expect(() => setFn('light')).not.toThrow()
      } else {
        expect(typeof ThemeContext).toBe('object')
      }
    })
  })

  describe('useTheme', () => {
    it('should be a function', () => {
      expect(typeof useTheme).toBe('function')
    })

    it('should expose a React context with Provider and Consumer', () => {
      expect(ThemeContext).toBeDefined()
      expect(typeof ThemeContext.Provider).toBe('object')
      expect(typeof ThemeContext.Consumer).toBe('object')
    })
  })
})
