import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InMemoryEventBus } from './InMemoryEventBus.js'
import type { ExecutionEvent } from '../interfaces/EventBus.js'

const started = (instanceId = 'inst-1'): ExecutionEvent => ({
  type: 'ProcessInstanceStarted',
  instanceId,
  definitionId: 'proc-1',
  definitionVersion: 1,
})

const completed = (instanceId = 'inst-1'): ExecutionEvent => ({
  type: 'ProcessInstanceCompleted',
  instanceId,
  durationMs: 100,
})

describe('InMemoryEventBus', () => {
  let bus: InMemoryEventBus

  beforeEach(() => {
    bus = new InMemoryEventBus()
  })

  describe('publish', () => {
    it('records the event in the published log', async () => {
      await bus.publish(started())
      expect(bus.getAll()).toHaveLength(1)
      expect(bus.getAll()[0]?.type).toBe('ProcessInstanceStarted')
    })

    it('delivers the event to all subscribers', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      bus.subscribe(handler1)
      bus.subscribe(handler2)
      await bus.publish(started())
      expect(handler1).toHaveBeenCalledOnce()
      expect(handler2).toHaveBeenCalledOnce()
    })

    it('awaits async handlers', async () => {
      const order: number[] = []
      bus.subscribe(async () => { await Promise.resolve(); order.push(1) })
      bus.subscribe(async () => { order.push(2) })
      await bus.publish(started())
      expect(order).toEqual([1, 2])
    })
  })

  describe('publishMany', () => {
    it('publishes all events in order', async () => {
      await bus.publishMany([started(), completed()])
      expect(bus.getAll().map(e => e.type)).toEqual([
        'ProcessInstanceStarted',
        'ProcessInstanceCompleted',
      ])
    })
  })

  describe('subscribe', () => {
    it('returns an unsubscribe function that stops delivery', async () => {
      const handler = vi.fn()
      const unsubscribe = bus.subscribe(handler)
      await bus.publish(started())
      unsubscribe()
      await bus.publish(completed())
      expect(handler).toHaveBeenCalledOnce()
    })

    it('does not affect other subscribers when one unsubscribes', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      const unsub1 = bus.subscribe(handler1)
      bus.subscribe(handler2)
      unsub1()
      await bus.publish(started())
      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).toHaveBeenCalledOnce()
    })
  })

  describe('subscribeToType', () => {
    it('only delivers events of the matching type', async () => {
      const handler = vi.fn()
      bus.subscribeToType('ProcessInstanceStarted', handler)
      await bus.publish(started())
      await bus.publish(completed())
      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'ProcessInstanceStarted' }))
    })

    it('returns an unsubscribe function', async () => {
      const handler = vi.fn()
      const unsub = bus.subscribeToType('ProcessInstanceStarted', handler)
      unsub()
      await bus.publish(started())
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('getByType', () => {
    it('returns only events of the given type', async () => {
      await bus.publish(started('inst-1'))
      await bus.publish(started('inst-2'))
      await bus.publish(completed('inst-1'))
      const startedEvents = bus.getByType('ProcessInstanceStarted')
      expect(startedEvents).toHaveLength(2)
      expect(startedEvents.every(e => e.type === 'ProcessInstanceStarted')).toBe(true)
    })
  })

  describe('reset', () => {
    it('clears the published log but keeps subscribers', async () => {
      const handler = vi.fn()
      bus.subscribe(handler)
      await bus.publish(started())
      bus.reset()
      expect(bus.getAll()).toHaveLength(0)
      await bus.publish(completed())
      expect(handler).toHaveBeenCalledTimes(2) // once before reset, once after
    })
  })

  describe('clear', () => {
    it('clears both the log and all subscribers', async () => {
      const handler = vi.fn()
      bus.subscribe(handler)
      await bus.publish(started())
      bus.clear()
      await bus.publish(completed())
      expect(bus.getAll()).toHaveLength(1) // only the post-clear event
      expect(handler).toHaveBeenCalledOnce() // only before clear
    })
  })
})
