import { describe, it, expect } from 'vitest'
import { routing } from './routing'

describe('i18n routing config', () => {
  it('defines exactly three supported locales', () => {
    expect(routing.locales).toHaveLength(3)
    expect(routing.locales).toContain('fr')
    expect(routing.locales).toContain('en')
    expect(routing.locales).toContain('es')
  })

  it('uses French as the default locale', () => {
    expect(routing.defaultLocale).toBe('fr')
  })

  it('default locale is in the locales list', () => {
    expect(routing.locales).toContain(routing.defaultLocale)
  })
})
