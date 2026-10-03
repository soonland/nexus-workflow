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
