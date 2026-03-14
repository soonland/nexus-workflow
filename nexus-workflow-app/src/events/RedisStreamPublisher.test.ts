import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InMemoryEventBus, type ExecutionEvent } from 'nexus-workflow-core'

const mockState = vi.hoisted(() => ({
  connect: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn().mockResolvedValue('OK'),
  xadd: vi.fn().mockResolvedValue('stream-id-1'),
}))

vi.mock('ioredis', () => {
  class Redis {
    connect = mockState.connect
    quit = mockState.quit
    xadd = mockState.xadd
  }
  return { Redis, default: Redis }
})

import { RedisStreamPublisher, STREAM_KEY } from './RedisStreamPublisher.js'

describe('RedisStreamPublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.connect.mockResolvedValue(undefined)
    mockState.quit.mockResolvedValue('OK')
    mockState.xadd.mockResolvedValue('stream-id-1')
  })

  it('STREAM_KEY is the expected constant', () => {
    expect(STREAM_KEY).toBe('nexus:workflow:events')
  })

  it('connect() calls redis.connect()', async () => {
    const publisher = new RedisStreamPublisher('redis://localhost:6379')
    await publisher.connect()
    expect(mockState.connect).toHaveBeenCalledOnce()
  })

  it('disconnect() calls redis.quit()', async () => {
    const publisher = new RedisStreamPublisher('redis://localhost:6379')
    await publisher.disconnect()
    expect(mockState.quit).toHaveBeenCalledOnce()
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
    await new Promise(r => setTimeout(r, 10))

    expect(mockState.xadd).toHaveBeenCalledWith(
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

    expect(mockState.xadd).toHaveBeenCalledTimes(2)
  })

  it('does not throw when xadd fails — error is swallowed', async () => {
    mockState.xadd.mockRejectedValueOnce(new Error('Redis connection lost'))

    const publisher = new RedisStreamPublisher('redis://localhost:6379')
    const eventBus = new InMemoryEventBus()
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
  })
})
