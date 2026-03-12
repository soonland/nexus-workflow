import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { TaskContext } from 'nexus-workflow-core'
import { HttpCallHandler } from './HttpCallHandler.js'
import { LogHandler } from './LogHandler.js'

// ─── Shared context builder ───────────────────────────────────────────────────

function makeCtx(variables: Record<string, { type: string; value: unknown }> = {}): TaskContext {
  return {
    instanceId: 'inst-1',
    tokenId: 'tok-1',
    elementId: 'svc-1',
    taskType: 'http-call',
    attempt: 1,
    variables: variables as TaskContext['variables'],
  }
}

// ─── HttpCallHandler ──────────────────────────────────────────────────────────

describe('HttpCallHandler', () => {
  const handler = new HttpCallHandler()

  it('taskType is "http-call"', () => {
    expect(handler.taskType).toBe('http-call')
  })

  it('returns error when url variable is missing', async () => {
    const result = await handler.execute(makeCtx())
    expect(result.status).toBe('error')
    expect(result.error?.code).toBe('INVALID_INPUT')
  })

  it('returns error when url variable is not a string', async () => {
    const result = await handler.execute(makeCtx({ url: { type: 'number', value: 42 } }))
    expect(result.status).toBe('error')
    expect(result.error?.code).toBe('INVALID_INPUT')
  })

  it('returns error when url is an empty string', async () => {
    const result = await handler.execute(makeCtx({ url: { type: 'string', value: '' } }))
    expect(result.status).toBe('error')
    expect(result.error?.code).toBe('INVALID_INPUT')
  })

  describe('successful HTTP calls', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn())
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('performs a GET request and returns statusCode + responseBody on success', async () => {
      const mockResponse = {
        status: 200,
        text: vi.fn().mockResolvedValue('{"ok":true}'),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      const result = await handler.execute(makeCtx({ url: { type: 'string', value: 'https://example.com/api' } }))

      expect(result.status).toBe('completed')
      expect(result.outputVariables?.['statusCode']).toEqual({ type: 'number', value: 200 })
      expect(result.outputVariables?.['responseBody']).toEqual({ type: 'string', value: '{"ok":true}' })
    })

    it('uses GET as default method when method variable is not set', async () => {
      const mockResponse = { status: 200, text: vi.fn().mockResolvedValue('') }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      await handler.execute(makeCtx({ url: { type: 'string', value: 'https://example.com' } }))

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({ method: 'GET' }),
      )
    })

    it('passes custom method variable to fetch', async () => {
      const mockResponse = { status: 201, text: vi.fn().mockResolvedValue('created') }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      await handler.execute(makeCtx({
        url: { type: 'string', value: 'https://example.com/items' },
        method: { type: 'string', value: 'POST' },
      }))

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'https://example.com/items',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    it('passes body variable to fetch when set', async () => {
      const mockResponse = { status: 200, text: vi.fn().mockResolvedValue('ok') }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      await handler.execute(makeCtx({
        url: { type: 'string', value: 'https://example.com' },
        method: { type: 'string', value: 'POST' },
        body: { type: 'string', value: '{"foo":"bar"}' },
      }))

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({ body: '{"foo":"bar"}' }),
      )
    })

    it('passes extra headers to fetch when headers variable is set', async () => {
      const mockResponse = { status: 200, text: vi.fn().mockResolvedValue('') }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      await handler.execute(makeCtx({
        url: { type: 'string', value: 'https://example.com' },
        headers: { type: 'object', value: { Authorization: 'Bearer token-123' } },
      }))

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({ headers: { Authorization: 'Bearer token-123' } }),
      )
    })

    it('ignores headers variable if it is an array', async () => {
      const mockResponse = { status: 200, text: vi.fn().mockResolvedValue('') }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      await handler.execute(makeCtx({
        url: { type: 'string', value: 'https://example.com' },
        headers: { type: 'array', value: ['bad'] },
      }))

      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({ headers: {} }),
      )
    })

    it('returns statusCode from a non-200 response', async () => {
      const mockResponse = { status: 404, text: vi.fn().mockResolvedValue('Not Found') }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      const result = await handler.execute(makeCtx({ url: { type: 'string', value: 'https://example.com/missing' } }))

      expect(result.status).toBe('completed')
      expect(result.outputVariables?.['statusCode']).toEqual({ type: 'number', value: 404 })
    })
  })

  describe('network errors', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn())
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('returns retry with NETWORK_ERROR when fetch throws', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'))

      const result = await handler.execute(makeCtx({ url: { type: 'string', value: 'https://unreachable.example' } }))

      expect(result.status).toBe('retry')
      expect(result.error?.code).toBe('NETWORK_ERROR')
      expect(result.error?.message).toBe('ECONNREFUSED')
    })

    it('returns retry with stringified error when fetch throws a non-Error', async () => {
      vi.mocked(fetch).mockRejectedValue('timeout')

      const result = await handler.execute(makeCtx({ url: { type: 'string', value: 'https://example.com' } }))

      expect(result.status).toBe('retry')
      expect(result.error?.code).toBe('NETWORK_ERROR')
      expect(result.error?.message).toBe('timeout')
    })
  })
})

// ─── LogHandler ───────────────────────────────────────────────────────────────

describe('LogHandler', () => {
  const handler = new LogHandler()

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('taskType is "log"', () => {
    expect(handler.taskType).toBe('log')
  })

  it('always returns completed status', async () => {
    const result = await handler.execute(makeCtx({ message: { type: 'string', value: 'hello' } }))
    expect(result.status).toBe('completed')
  })

  it('logs to console.log when level is "info" (default)', async () => {
    await handler.execute(makeCtx({ message: { type: 'string', value: 'info message' } }))
    expect(console.log).toHaveBeenCalledWith('info message')
    expect(console.warn).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('logs to console.log when level is explicitly "info"', async () => {
    await handler.execute(makeCtx({
      message: { type: 'string', value: 'explicit info' },
      level: { type: 'string', value: 'info' },
    }))
    expect(console.log).toHaveBeenCalledWith('explicit info')
  })

  it('logs to console.warn when level is "warn"', async () => {
    await handler.execute(makeCtx({
      message: { type: 'string', value: 'warn message' },
      level: { type: 'string', value: 'warn' },
    }))
    expect(console.warn).toHaveBeenCalledWith('warn message')
    expect(console.log).not.toHaveBeenCalled()
  })

  it('logs to console.error when level is "error"', async () => {
    await handler.execute(makeCtx({
      message: { type: 'string', value: 'error message' },
      level: { type: 'string', value: 'error' },
    }))
    expect(console.error).toHaveBeenCalledWith('error message')
    expect(console.log).not.toHaveBeenCalled()
  })

  it('uses a default message when message variable is not set', async () => {
    await handler.execute(makeCtx())
    expect(console.log).toHaveBeenCalled()
    const [msg] = (console.log as ReturnType<typeof vi.spyOn>).mock.calls[0]!
    expect(typeof msg).toBe('string')
    expect(msg.length).toBeGreaterThan(0)
  })

  it('default message includes instanceId and elementId', async () => {
    await handler.execute(makeCtx())
    const [msg] = (console.log as ReturnType<typeof vi.spyOn>).mock.calls[0]!
    expect(msg).toContain('inst-1')
    expect(msg).toContain('svc-1')
  })
})
