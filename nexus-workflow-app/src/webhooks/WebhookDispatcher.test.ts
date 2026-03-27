import { createHmac } from 'node:crypto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { InMemoryEventBus } from 'nexus-workflow-core'
import { InMemoryWebhookStore } from './WebhookStore.js'
import { WebhookDispatcher, computeSignature } from './WebhookDispatcher.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOkResponse(): Response {
  return { ok: true, status: 200 } as Response
}

function makeFailResponse(status = 500): Response {
  return { ok: false, status } as Response
}

/** Minimal ProcessInstanceCompleted event. */
const COMPLETED_EVENT = {
  type: 'ProcessInstanceCompleted' as const,
  instanceId: 'inst-1',
  durationMs: 42,
}

/** Minimal ProcessInstanceStarted event. */
const STARTED_EVENT = {
  type: 'ProcessInstanceStarted' as const,
  instanceId: 'inst-1',
  definitionId: 'def-1',
  definitionVersion: 1,
}

// ─── computeSignature ─────────────────────────────────────────────────────────

describe('computeSignature', () => {
  it('should return a string prefixed with sha256=', () => {
    const sig = computeSignature('my-secret', '{"hello":"world"}')
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it('should be deterministic for the same secret and body', () => {
    const body = '{"event":"test"}'
    const sig1 = computeSignature('secret', body)
    const sig2 = computeSignature('secret', body)
    expect(sig1).toBe(sig2)
  })

  it('should match a manually computed HMAC-SHA256', () => {
    const secret = 'test-secret'
    const body = '{"type":"ping"}'
    const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
    expect(computeSignature(secret, body)).toBe(expected)
  })

  it('should produce different signatures for different secrets', () => {
    const body = '{"event":"test"}'
    const sig1 = computeSignature('secret-a', body)
    const sig2 = computeSignature('secret-b', body)
    expect(sig1).not.toBe(sig2)
  })

  it('should produce different signatures for different bodies', () => {
    const secret = 'same-secret'
    const sig1 = computeSignature(secret, '{"a":1}')
    const sig2 = computeSignature(secret, '{"a":2}')
    expect(sig1).not.toBe(sig2)
  })
})

// ─── WebhookDispatcher ────────────────────────────────────────────────────────

describe('WebhookDispatcher', () => {
  let store: InMemoryWebhookStore
  let eventBus: InMemoryEventBus
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    store = new InMemoryWebhookStore()
    eventBus = new InMemoryEventBus()
    mockFetch = vi.fn()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function makeDispatcher(opts: { maxAttempts?: number; baseRetryDelayMs?: number } = {}) {
    return new WebhookDispatcher(store, eventBus, {
      fetch: mockFetch,
      maxAttempts: opts.maxAttempts ?? 1,
      baseRetryDelayMs: opts.baseRetryDelayMs ?? 0,
    })
  }

  // ─── dispatch: basic delivery ──────────────────────────────────────────────

  describe('dispatch', () => {
    it('should POST to a registered webhook URL when an event is emitted', async () => {
      mockFetch.mockResolvedValue(makeOkResponse())
      await store.save({ url: 'https://example.com/hook', events: [] })

      const dispatcher = makeDispatcher()
      dispatcher.start()

      await eventBus.publish(COMPLETED_EVENT)
      await vi.runAllTimersAsync()

      expect(mockFetch).toHaveBeenCalledOnce()
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://example.com/hook')
      expect(init.method).toBe('POST')
    })

    it('should send JSON body containing the event', async () => {
      mockFetch.mockResolvedValue(makeOkResponse())
      await store.save({ url: 'https://example.com/hook', events: [] })

      const dispatcher = makeDispatcher()
      dispatcher.start()

      await eventBus.publish(COMPLETED_EVENT)
      await vi.runAllTimersAsync()

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      const parsed = JSON.parse(init.body as string)
      expect(parsed).toEqual({ event: COMPLETED_EVENT })
    })

    it('should set Content-Type: application/json header', async () => {
      mockFetch.mockResolvedValue(makeOkResponse())
      await store.save({ url: 'https://example.com/hook', events: [] })

      const dispatcher = makeDispatcher()
      dispatcher.start()

      await eventBus.publish(COMPLETED_EVENT)
      await vi.runAllTimersAsync()

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    })

    it('should POST to all registered webhooks when an event is emitted', async () => {
      mockFetch.mockResolvedValue(makeOkResponse())
      await store.save({ url: 'https://hook1.example.com/', events: [] })
      await store.save({ url: 'https://hook2.example.com/', events: [] })

      const dispatcher = makeDispatcher()
      dispatcher.start()

      await eventBus.publish(COMPLETED_EVENT)
      await vi.runAllTimersAsync()

      expect(mockFetch).toHaveBeenCalledTimes(2)
      const urls = mockFetch.mock.calls.map(([url]) => url as string)
      expect(urls).toContain('https://hook1.example.com/')
      expect(urls).toContain('https://hook2.example.com/')
    })
  })

  // ─── Event filter matching ─────────────────────────────────────────────────

  describe('event filter matching', () => {
    it('should deliver to webhook with matching event type in filter', async () => {
      mockFetch.mockResolvedValue(makeOkResponse())
      await store.save({ url: 'https://example.com/hook', events: ['ProcessInstanceCompleted'] })

      const dispatcher = makeDispatcher()
      dispatcher.start()

      await eventBus.publish(COMPLETED_EVENT)
      await vi.runAllTimersAsync()

      expect(mockFetch).toHaveBeenCalledOnce()
    })

    it('should not deliver to webhook when event type is not in the filter', async () => {
      mockFetch.mockResolvedValue(makeOkResponse())
      await store.save({ url: 'https://example.com/hook', events: ['ProcessInstanceCompleted'] })

      const dispatcher = makeDispatcher()
      dispatcher.start()

      await eventBus.publish(STARTED_EVENT)
      await vi.runAllTimersAsync()

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should deliver to webhook with empty events filter for any event type', async () => {
      mockFetch.mockResolvedValue(makeOkResponse())
      await store.save({ url: 'https://example.com/hook', events: [] })

      const dispatcher = makeDispatcher()
      dispatcher.start()

      await eventBus.publish(STARTED_EVENT)
      await vi.runAllTimersAsync()

      expect(mockFetch).toHaveBeenCalledOnce()
    })

    it('should selectively deliver — matching webhook receives, non-matching does not', async () => {
      mockFetch.mockResolvedValue(makeOkResponse())
      await store.save({ url: 'https://hook-all.example.com/', events: [] })
      await store.save({ url: 'https://hook-completed.example.com/', events: ['ProcessInstanceCompleted'] })

      const dispatcher = makeDispatcher()
      dispatcher.start()

      await eventBus.publish(STARTED_EVENT)
      await vi.runAllTimersAsync()

      expect(mockFetch).toHaveBeenCalledOnce()
      const [url] = mockFetch.mock.calls[0] as [string]
      expect(url).toBe('https://hook-all.example.com/')
    })
  })

  // ─── HMAC signature header ─────────────────────────────────────────────────

  describe('HMAC signature header', () => {
    it('should set X-Nexus-Signature header when webhook has a secret', async () => {
      mockFetch.mockResolvedValue(makeOkResponse())
      await store.save({ url: 'https://example.com/hook', events: [], secret: 'my-secret' })

      const dispatcher = makeDispatcher()
      dispatcher.start()

      await eventBus.publish(COMPLETED_EVENT)
      await vi.runAllTimersAsync()

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      const headers = init.headers as Record<string, string>
      expect(headers['X-Nexus-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/)
    })

    it('should set X-Nexus-Signature to the correct HMAC of the request body', async () => {
      mockFetch.mockResolvedValue(makeOkResponse())
      const secret = 'my-secret'
      await store.save({ url: 'https://example.com/hook', events: [], secret })

      const dispatcher = makeDispatcher()
      dispatcher.start()

      await eventBus.publish(COMPLETED_EVENT)
      await vi.runAllTimersAsync()

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      const headers = init.headers as Record<string, string>
      const expectedSig = computeSignature(secret, init.body as string)
      expect(headers['X-Nexus-Signature']).toBe(expectedSig)
    })

    it('should not set X-Nexus-Signature header when webhook has no secret', async () => {
      mockFetch.mockResolvedValue(makeOkResponse())
      await store.save({ url: 'https://example.com/hook', events: [] })

      const dispatcher = makeDispatcher()
      dispatcher.start()

      await eventBus.publish(COMPLETED_EVENT)
      await vi.runAllTimersAsync()

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      const headers = init.headers as Record<string, string>
      expect(headers['X-Nexus-Signature']).toBeUndefined()
    })
  })

  // ─── X-Nexus-Event header ─────────────────────────────────────────────────

  describe('X-Nexus-Event header', () => {
    it('should set X-Nexus-Event header to the event type', async () => {
      mockFetch.mockResolvedValue(makeOkResponse())
      await store.save({ url: 'https://example.com/hook', events: [] })

      const dispatcher = makeDispatcher()
      dispatcher.start()

      await eventBus.publish(COMPLETED_EVENT)
      await vi.runAllTimersAsync()

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      const headers = init.headers as Record<string, string>
      expect(headers['X-Nexus-Event']).toBe('ProcessInstanceCompleted')
    })

    it('should set X-Nexus-Event to the correct type for each event', async () => {
      mockFetch.mockResolvedValue(makeOkResponse())
      await store.save({ url: 'https://example.com/hook', events: [] })

      const dispatcher = makeDispatcher()
      dispatcher.start()

      await eventBus.publish(STARTED_EVENT)
      await vi.runAllTimersAsync()

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      const headers = init.headers as Record<string, string>
      expect(headers['X-Nexus-Event']).toBe('ProcessInstanceStarted')
    })
  })

  // ─── Retry on non-2xx ─────────────────────────────────────────────────────

  describe('retry on non-2xx response', () => {
    it('should retry up to maxAttempts on non-2xx response', async () => {
      mockFetch.mockResolvedValue(makeFailResponse(500))
      await store.save({ url: 'https://example.com/hook', events: [] })

      const dispatcher = new WebhookDispatcher(store, eventBus, {
        fetch: mockFetch,
        maxAttempts: 3,
        baseRetryDelayMs: 0,
      })
      dispatcher.start()

      await eventBus.publish(COMPLETED_EVENT)
      await vi.runAllTimersAsync()

      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('should stop retrying after a successful response', async () => {
      mockFetch
        .mockResolvedValueOnce(makeFailResponse(500))
        .mockResolvedValueOnce(makeOkResponse())
      await store.save({ url: 'https://example.com/hook', events: [] })

      const dispatcher = new WebhookDispatcher(store, eventBus, {
        fetch: mockFetch,
        maxAttempts: 3,
        baseRetryDelayMs: 0,
      })
      dispatcher.start()

      await eventBus.publish(COMPLETED_EVENT)
      await vi.runAllTimersAsync()

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should not exceed maxAttempts even if all responses fail', async () => {
      mockFetch.mockResolvedValue(makeFailResponse(503))
      await store.save({ url: 'https://example.com/hook', events: [] })

      const dispatcher = new WebhookDispatcher(store, eventBus, {
        fetch: mockFetch,
        maxAttempts: 3,
        baseRetryDelayMs: 0,
      })
      dispatcher.start()

      await eventBus.publish(COMPLETED_EVENT)
      await vi.runAllTimersAsync()

      expect(mockFetch).toHaveBeenCalledTimes(3)
    })
  })

  // ─── Error resilience ─────────────────────────────────────────────────────

  describe('error resilience', () => {
    it('should not throw when fetch rejects', async () => {
      mockFetch.mockRejectedValue(new Error('network failure'))
      await store.save({ url: 'https://example.com/hook', events: [] })

      const dispatcher = makeDispatcher()
      dispatcher.start()

      // Publishing should not cause an unhandled rejection
      await expect(eventBus.publish(COMPLETED_EVENT)).resolves.not.toThrow()
      await vi.runAllTimersAsync()
    })

    it('should deliver to other webhooks even if one fetch throws', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('network failure'))
        .mockResolvedValueOnce(makeOkResponse())
      await store.save({ url: 'https://failing.example.com/', events: [] })
      await store.save({ url: 'https://healthy.example.com/', events: [] })

      const dispatcher = makeDispatcher()
      dispatcher.start()

      await eventBus.publish(COMPLETED_EVENT)
      await vi.runAllTimersAsync()

      const urls = mockFetch.mock.calls.map(([url]) => url as string)
      expect(urls).toContain('https://healthy.example.com/')
    })
  })

  // ─── stop() ───────────────────────────────────────────────────────────────

  describe('stop()', () => {
    it('should not deliver events emitted after stop() is called', async () => {
      mockFetch.mockResolvedValue(makeOkResponse())
      await store.save({ url: 'https://example.com/hook', events: [] })

      const dispatcher = makeDispatcher()
      dispatcher.start()
      dispatcher.stop()

      await eventBus.publish(COMPLETED_EVENT)
      await vi.runAllTimersAsync()

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should allow start() after stop() to resume delivery', async () => {
      mockFetch.mockResolvedValue(makeOkResponse())
      await store.save({ url: 'https://example.com/hook', events: [] })

      const dispatcher = makeDispatcher()
      dispatcher.start()
      dispatcher.stop()

      // Re-start and publish
      dispatcher.start()
      await eventBus.publish(COMPLETED_EVENT)
      await vi.runAllTimersAsync()

      expect(mockFetch).toHaveBeenCalledOnce()
    })

    it('should not double-subscribe when start() is called twice', async () => {
      mockFetch.mockResolvedValue(makeOkResponse())
      await store.save({ url: 'https://example.com/hook', events: [] })

      const dispatcher = makeDispatcher()
      dispatcher.start()
      dispatcher.start() // second call should be a no-op

      await eventBus.publish(COMPLETED_EVENT)
      await vi.runAllTimersAsync()

      // Only one webhook registered, so only one POST regardless of start() calls
      expect(mockFetch).toHaveBeenCalledOnce()
    })
  })
})
