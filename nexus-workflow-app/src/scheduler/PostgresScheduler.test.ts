import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { InMemoryStateStore ,type  ScheduledTimer } from 'nexus-workflow-core'
import { PostgresScheduler } from './PostgresScheduler.js'

function makeTimer(overrides: Partial<ScheduledTimer> = {}): ScheduledTimer {
  const now = new Date()
  return {
    id: 'timer-1',
    instanceId: 'inst-1',
    tokenId: 'tok-1',
    fireAt: new Date(now.getTime() - 1000),  // past → due immediately
    createdAt: now,
    ...overrides,
  }
}

describe('PostgresScheduler', () => {
  let store: InMemoryStateStore
  let scheduler: PostgresScheduler

  beforeEach(() => {
    store = new InMemoryStateStore()
    vi.useFakeTimers()
    scheduler = new PostgresScheduler(store, { pollIntervalMs: 1000 })
  })

  afterEach(async () => {
    await scheduler.stop()
    vi.useRealTimers()
  })

  // ─── schedule() / cancel() ──────────────────────────────────────────────────

  describe('schedule()', () => {
    it('persists the timer in the store', async () => {
      const timer = makeTimer()
      await scheduler.schedule(timer)
      const due = await store.getDueTimers(new Date(timer.fireAt.getTime() + 1))
      expect(due).toHaveLength(1)
      expect(due[0]!.id).toBe('timer-1')
    })

    it('stores multiple timers independently', async () => {
      const t1 = makeTimer({ id: 'timer-1', tokenId: 'tok-1' })
      const t2 = makeTimer({ id: 'timer-2', tokenId: 'tok-2' })
      await scheduler.schedule(t1)
      await scheduler.schedule(t2)
      const due = await store.getDueTimers(new Date())
      expect(due).toHaveLength(2)
    })
  })

  describe('cancel()', () => {
    it('removes a scheduled timer from the store', async () => {
      await scheduler.schedule(makeTimer())
      await scheduler.cancel('timer-1')
      const due = await store.getDueTimers(new Date())
      expect(due).toHaveLength(0)
    })

    it('is a no-op for an unknown timer id', async () => {
      await expect(scheduler.cancel('does-not-exist')).resolves.not.toThrow()
    })
  })

  // ─── Polling ────────────────────────────────────────────────────────────────

  describe('polling', () => {
    it('fires callback for a due timer on start()', async () => {
      const fired: ScheduledTimer[] = []
      scheduler.onTimerFired(async (t) => { fired.push(t) })

      await scheduler.schedule(makeTimer())
      // start() polls immediately and awaits completion before returning
      await scheduler.start()

      expect(fired).toHaveLength(1)
      expect(fired[0]!.id).toBe('timer-1')
    })

    it('deletes a timer from the store after firing it', async () => {
      scheduler.onTimerFired(async () => {})

      await scheduler.schedule(makeTimer())
      await scheduler.start()

      const due = await store.getDueTimers(new Date())
      expect(due).toHaveLength(0)
    })

    it('fires timers added after start() on the next poll tick', async () => {
      const fired: ScheduledTimer[] = []
      scheduler.onTimerFired(async (t) => { fired.push(t) })

      await scheduler.start()

      // Schedule a due timer after start
      await scheduler.schedule(makeTimer({ id: 'timer-late' }))

      // Advance one poll interval
      await vi.advanceTimersByTimeAsync(1000)

      expect(fired).toHaveLength(1)
      expect(fired[0]!.id).toBe('timer-late')
    })

    it('does not fire a timer that is not yet due', async () => {
      const fired: ScheduledTimer[] = []
      scheduler.onTimerFired(async (t) => { fired.push(t) })

      const future = makeTimer({ fireAt: new Date(Date.now() + 60_000) })
      await scheduler.schedule(future)
      await scheduler.start()
      // Initial poll ran during start(); timer was not yet due

      expect(fired).toHaveLength(0)
    })

    it('fires a future timer once it becomes due', async () => {
      const fired: ScheduledTimer[] = []
      scheduler.onTimerFired(async (t) => { fired.push(t) })

      const future = makeTimer({ fireAt: new Date(Date.now() + 2500) })
      await scheduler.schedule(future)
      await scheduler.start()

      // Not fired yet
      await vi.advanceTimersByTimeAsync(1000)
      expect(fired).toHaveLength(0)

      // Advance past fireAt
      await vi.advanceTimersByTimeAsync(2000)
      expect(fired).toHaveLength(1)
    })

    it('fires multiple due timers in a single poll', async () => {
      const fired: string[] = []
      scheduler.onTimerFired(async (t) => { fired.push(t.id) })

      await scheduler.schedule(makeTimer({ id: 't1', tokenId: 'tok-1' }))
      await scheduler.schedule(makeTimer({ id: 't2', tokenId: 'tok-2' }))
      await scheduler.schedule(makeTimer({ id: 't3', tokenId: 'tok-3' }))

      await scheduler.start()

      expect(fired.sort()).toEqual(['t1', 't2', 't3'])
    })

    it('calls multiple registered callbacks for each timer', async () => {
      const calls1: string[] = []
      const calls2: string[] = []
      scheduler.onTimerFired(async (t) => { calls1.push(t.id) })
      scheduler.onTimerFired(async (t) => { calls2.push(t.id) })

      await scheduler.schedule(makeTimer())
      await scheduler.start()

      expect(calls1).toHaveLength(1)
      expect(calls2).toHaveLength(1)
    })
  })

  // ─── start() / stop() ───────────────────────────────────────────────────────

  describe('start() and stop()', () => {
    it('start() is idempotent — calling twice fires callbacks only once', async () => {
      const fired: ScheduledTimer[] = []
      scheduler.onTimerFired(async (t) => { fired.push(t) })

      await scheduler.schedule(makeTimer())
      await scheduler.start()
      await scheduler.start()  // second call should be no-op

      expect(fired).toHaveLength(1)
    })

    it('stop() prevents further polling after being called', async () => {
      const fired: ScheduledTimer[] = []
      scheduler.onTimerFired(async (t) => { fired.push(t) })

      await scheduler.start()
      await scheduler.stop()

      await scheduler.schedule(makeTimer({ id: 'after-stop' }))
      await vi.advanceTimersByTimeAsync(5000)

      expect(fired).toHaveLength(0)
    })

    it('can be restarted after stop()', async () => {
      const fired: ScheduledTimer[] = []
      scheduler.onTimerFired(async (t) => { fired.push(t) })

      await scheduler.start()
      await scheduler.stop()

      await scheduler.schedule(makeTimer())
      await scheduler.start()

      expect(fired).toHaveLength(1)
    })

    it('defaults to 5000ms poll interval when no options provided', async () => {
      const defaultScheduler = new PostgresScheduler(store)
      const fired: ScheduledTimer[] = []
      defaultScheduler.onTimerFired(async (t) => { fired.push(t) })

      await defaultScheduler.schedule(makeTimer())
      await defaultScheduler.start()

      expect(fired).toHaveLength(1)
      await defaultScheduler.stop()
    })
  })
})
