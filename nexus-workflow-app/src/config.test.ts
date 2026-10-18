import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertConfigValid, config } from './config.js'

describe('assertConfigValid: PUBLIC_ORIGIN', () => {
  let exit: ReturnType<typeof vi.spyOn>
  let error: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts a configuration whose public origin is fine or not set', () => {
    assertConfigValid({ ...config, publicOriginInvalid: undefined })
    expect(exit).not.toHaveBeenCalled()
  })

  it('exits with a message that names the setting when PUBLIC_ORIGIN could not be understood', () => {
    assertConfigValid({ ...config, publicOriginInvalid: 'workflow.example.com' })

    expect(exit).toHaveBeenCalledWith(1)
    expect(error.mock.calls.flat().join(' ')).toMatch(/PUBLIC_ORIGIN/)
    expect(error.mock.calls.flat().join(' ')).toContain('workflow.example.com')
  })
})

describe('assertConfigValid: ADMIN_API_KEY', () => {
  let exit: ReturnType<typeof vi.spyOn>
  let error: ReturnType<typeof vi.spyOn>
  let warn: ReturnType<typeof vi.spyOn>
  const base = { ...config, publicOriginInvalid: undefined, trustedProxies: 0, apiKeyHmacSecret: 'secret' }

  beforeEach(() => {
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    error = vi.spyOn(console, 'error').mockImplementation(() => {})
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts silently in production when it is unset', () => {
    assertConfigValid({ ...base, nodeEnv: 'production', adminApiKey: '' })
    expect(exit).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('warns once, naming the setting, when it is set in production', () => {
    assertConfigValid({ ...base, nodeEnv: 'production', adminApiKey: 'x'.repeat(32) })
    expect(exit).not.toHaveBeenCalled()
    const adminWarnings = warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes('ADMIN_API_KEY'))
    expect(adminWarnings).toHaveLength(1)
  })

  it('refuses a short key in production', () => {
    assertConfigValid({ ...base, nodeEnv: 'production', adminApiKey: 'short' })
    expect(exit).toHaveBeenCalledWith(1)
    expect(error.mock.calls.flat().join(' ')).toContain('ADMIN_API_KEY')
  })

  it('only warns about a short key in development, and not about being set', () => {
    assertConfigValid({ ...base, nodeEnv: 'development', adminApiKey: 'dev-admin-key' })
    expect(exit).not.toHaveBeenCalled()
    expect(warn.mock.calls.flat().join(' ')).toContain('shorter than')
    expect(warn.mock.calls.flat().join(' ')).not.toContain('set in production')
  })
})

describe('assertConfigValid: OPERATOR_KEY_MAX_DAYS', () => {
  const base = { ...config, publicOriginInvalid: undefined, trustedProxies: 0, apiKeyHmacSecret: 'secret' }
  let exit: ReturnType<typeof vi.spyOn>
  let error: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    error = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('accepts it unset or a positive number', () => {
    assertConfigValid({ ...base, operatorKeyMaxDays: undefined })
    assertConfigValid({ ...base, operatorKeyMaxDays: 90 })
    expect(exit).not.toHaveBeenCalled()
  })

  it('exits with a message that names the setting when it is not a positive whole number', () => {
    assertConfigValid({ ...base, operatorKeyMaxDays: Number.NaN })
    expect(exit).toHaveBeenCalledWith(1)
    expect(error.mock.calls.flat().join(' ')).toContain('OPERATOR_KEY_MAX_DAYS')
  })
})
