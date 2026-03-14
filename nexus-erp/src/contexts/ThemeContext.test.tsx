// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import * as React from 'react'
import { renderHook, cleanup, act } from '@testing-library/react'
import { ThemeContext, useTheme } from '@/contexts/ThemeContext'
import type { ThemeId } from '@/lib/theme'

afterEach(() => {
  cleanup()
})

describe('ThemeContext default value', () => {
  it('should have themeId set to "default"', () => {
    const ctx = ThemeContext as unknown as { _currentValue: { themeId: ThemeId } }
    expect(ctx._currentValue.themeId).toBe('default')
  })

  it('should have a no-op setThemeId that does not throw', () => {
    const ctx = ThemeContext as unknown as { _currentValue: { setThemeId: (id: ThemeId) => void } }
    expect(() => ctx._currentValue.setThemeId('nexus-premium-dark')).not.toThrow()
  })

  it('should expose Provider and Consumer on the context object', () => {
    expect(ThemeContext.Provider).toBeDefined()
    expect(ThemeContext.Consumer).toBeDefined()
  })
})

describe('useTheme', () => {
  it('should return the default themeId when used outside a Provider', () => {
    const { result } = renderHook(() => useTheme())

    expect(result.current.themeId).toBe('default')
  })

  it('should return a function as setThemeId when used outside a Provider', () => {
    const { result } = renderHook(() => useTheme())

    expect(typeof result.current.setThemeId).toBe('function')
  })

  it('should return the provided themeId when wrapped in a ThemeContext.Provider', () => {
    const setThemeId = () => {}

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ThemeContext.Provider, { value: { themeId: 'nexus-premium-dark', setThemeId } }, children)

    const { result } = renderHook(() => useTheme(), { wrapper })

    expect(result.current.themeId).toBe('nexus-premium-dark')
  })

  it('should return the provided setThemeId function when wrapped in a ThemeContext.Provider', () => {
    const setThemeId = () => {}

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ThemeContext.Provider, { value: { themeId: 'default', setThemeId } }, children)

    const { result } = renderHook(() => useTheme(), { wrapper })

    expect(result.current.setThemeId).toBe(setThemeId)
  })

  it('should return updated themeId when the Provider value changes', () => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => {
      const [themeId, setThemeId] = React.useState<ThemeId>('default')
      return React.createElement(
        ThemeContext.Provider,
        { value: { themeId, setThemeId } },
        children,
      )
    }

    const { result } = renderHook(() => useTheme(), { wrapper: Wrapper })

    expect(result.current.themeId).toBe('default')

    // Trigger a state update through the exposed setter — must be wrapped in act()
    act(() => {
      result.current.setThemeId('nexus-premium-light')
    })

    expect(result.current.themeId).toBe('nexus-premium-light')
  })

  it('should return each valid ThemeId value correctly from the Provider', () => {
    const themeIds: ThemeId[] = ['default', 'nexus-premium-light', 'nexus-premium-dark']

    for (const id of themeIds) {
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(ThemeContext.Provider, { value: { themeId: id, setThemeId: () => {} } }, children)

      const { result } = renderHook(() => useTheme(), { wrapper })
      expect(result.current.themeId).toBe(id)
      cleanup()
    }
  })
})
