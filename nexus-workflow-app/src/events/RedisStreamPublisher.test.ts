import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InMemoryEventBus } from 'nexus-workflow-core'
import type { ExecutionEvent } from 'nexus-workflow-core'

// Mock ioredis before importing the module under test
vi.mock('ioredis', () => {
  const mockRedis = {
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue('OK'),
    xadd: vi.fn().mockResolvedValue('stream-id-1'),
  }
  return {
    Redis: vi.fn().mockImplementation(() => mockRedis),
    default: { Redis: vi.fn().mockImplementation(() => mockRedis) },
  }
})

import { RedisStreamPublisher, STREAM_KEY } from './RedisStreamPublisher.js'
import { Redis } from 'ioredis'

function getMockRedisInstance() {
  return (Redis as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
    connect: ReturnType<typeof vi.fn>
    quit: ReturnType<typeof vi.fn>
    xadd: ReturnType<typeof vi.fn>
  }
}

describe('RedisStreamPublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('STREAM_KEY is the expected constant', () => {
    expect(STREAM_KEY).toBe('nexus:workflow:events')
  })

  it('connect() calls redis.connect()', async () => {
    const publisher = new RedisStreamPublisher('redis://localhost:6379')
    await publisher.connect()
    const redis = getMockRedisInstance()
    expect(redis.connect).toHaveBeenCalledOnce()
  })

  it('disconnect() calls redis.quit()', async () => {
    const publisher = new RedisStreamPublisher('redis://localhost:6379')
    await publisher.disconnect()
    const redis = getMockRedisInstance()
    expect(redis.quit).toHaveBeenCalledOnce()
  })

  it('attach() subscribes to the event bus and publishes events via xadd', async () => {
    const publisher = new RedisStreamPublisher('redis://localhost:6379')
    const eventBus = new InMemoryEventBus()
    publisher.attach(eventBus)

    const event: ExecutionEvent = {
      type: 'ProcessInstanceStarted',
      instanceId: 'inst-1',
      definitionId: 'def-1',
      definitionVersion: 1,
    }

    await eventBus.publish(event)
    // Give the void promise a chance to resolve
    await new Promise(r => setTimeout(r, 10))

    const redis = getMockRedisInstance()
    expect(redis.xadd).toHaveBeenCalledWith(
      STREAM_KEY,
      '*',
      'type',
      'ProcessInstanceStarted',
      'data',
      JSON.stringify(event),
    )
  })

  it('attach() publishes multiple events to the stream', async () => {
    const publisher = new RedisStreamPublisher('redis://localhost:6379')
    const eventBus = new InMemoryEventBus()
    publisher.attach(eventBus)

    await eventBus.publish({ type: 'ProcessInstanceStarted', instanceId: 'inst-1', definitionId: 'def-1', definitionVersion: 1 })
    await eventBus.publish({ type: 'ProcessInstanceCompleted', instanceId: 'inst-1' } as unknown as ExecutionEvent)

    await new Promise(r => setTimeout(r, 10))

    const redis = getMockRedisInstance()
    expect(redis.xadd).toHaveBeenCalledTimes(2)
  })

  it('does not throw when xadd fails — error is swallowed', async () => {
    const publisher = new RedisStreamPublisher('redis://localhost:6379')
    const eventBus = new InMemoryEventBus()

    const redis = getMockRedisInstance()
    redis.xadd.mockRejectedValueOnce(new Error('Redis connection lost'))

    publisher.attach(eventBus)

    await expect(
      eventBus.publish({
        type: 'ProcessInstanceStarted',
        instanceId: 'inst-1',
        definitionId: 'def-1',
        definitionVersion: 1,
      })
    ).resolves.not.toThrow()

    await new Promise(r => setTimeout(r, 10))
    // The error is caught and logged internally — no unhandled rejection
  })
})
