import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { InMemoryScheduler } from './InMemoryScheduler.js'
import type { ScheduledTimer } from '../model/types.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTimer(id: string, offsetMs: number): ScheduledTimer {
  return {
    id,
    instanceId: 'inst-1',
    tokenId: `tok-${id}`,
    fireAt: new Date(Date.now() + offsetMs),
    createdAt: new Date(),
  }
}

// ─── schedule / cancel ────────────────────────────────────────────────────────

describe('InMemoryScheduler — schedule and cancel', () => {
  let scheduler: InMemoryScheduler

  beforeEach(() => {
    scheduler = new InMemoryScheduler()
  })

  it('getAll returns an empty array when no timers are scheduled', () => {
    expect(scheduler.getAll()).toEqual([])
  })

  it('schedule stores a timer retrievable via getAll', async () => {
    const timer = makeTimer('t1', 5000)
    await scheduler.schedule(timer)
    expect(scheduler.getAll()).toHaveLength(1)
    expect(scheduler.getAll()[0]?.id).toBe('t1')
  })

  it('schedule stores a defensive copy (mutating original does not affect stored timer)', async () => {
    const timer = makeTimer('t1', 5000)
    await scheduler.schedule(timer)
    ;(timer as any).id = 'mutated'
    expect(scheduler.getAll()[0]?.id).toBe('t1')
  })

  it('cancel removes the timer from the pending set', async () => {
    await scheduler.schedule(makeTimer('t1', 5000))
    await scheduler.cancel('t1')
    expect(scheduler.getAll()).toHaveLength(0)
  })

  it('cancel is a no-op for a timer id that does not exist', async () => {
    await expect(scheduler.cancel('nonexistent')).resolves.toBeUndefined()
  })

  it('scheduling multiple timers stores all of them', async () => {
    await scheduler.schedule(makeTimer('t1', 1000))
    await scheduler.schedule(makeTimer('t2', 2000))
    await scheduler.schedule(makeTimer('t3', 3000))
    expect(scheduler.getAll()).toHaveLength(3)
  })
})

// ─── onTimerFired / tickDue ───────────────────────────────────────────────────

describe('InMemoryScheduler — tickDue', () => {
  let scheduler: InMemoryScheduler

  beforeEach(() => {
    vi.useFakeTimers()
    scheduler = new InMemoryScheduler()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('tickDue fires callbacks for timers whose fireAt <= now', async () => {
    const fired: string[] = []
    scheduler.onTimerFired(async (t) => { fired.push(t.id) })

    // Schedule a timer in the past
    await scheduler.schedule({ ...makeTimer('t-past', 0), fireAt: new Date(Date.now() - 1000) })
    await scheduler.tickDue()

    expect(fired).toContain('t-past')
  })

  it('tickDue does not fire timers in the future', async () => {
    const fired: string[] = []
    scheduler.onTimerFired(async (t) => { fired.push(t.id) })

    await scheduler.schedule(makeTimer('t-future', 60_000))
    await scheduler.tickDue()

    expect(fired).toHaveLength(0)
  })

  it('tickDue removes fired timers from the pending set', async () => {
    scheduler.onTimerFired(async () => {})
    await scheduler.schedule({ ...makeTimer('t1', 0), fireAt: new Date(Date.now() - 1) })
    await scheduler.tickDue()
    expect(scheduler.getAll()).toHaveLength(0)
  })

  it('tickDue fires multiple overdue timers', async () => {
    const fired: string[] = []
    scheduler.onTimerFired(async (t) => { fired.push(t.id) })

    const past = new Date(Date.now() - 1)
    await scheduler.schedule({ ...makeTimer('t1', 0), fireAt: past })
    await scheduler.schedule({ ...makeTimer('t2', 0), fireAt: past })
    await scheduler.tickDue()

    expect(fired).toHaveLength(2)
    expect(fired).toContain('t1')
    expect(fired).toContain('t2')
  })

  it('tickDue invokes all registered callbacks for each timer', async () => {
    const log: string[] = []
    scheduler.onTimerFired(async (t) => { log.push(`cb1:${t.id}`) })
    scheduler.onTimerFired(async (t) => { log.push(`cb2:${t.id}`) })

    await scheduler.schedule({ ...makeTimer('t1', 0), fireAt: new Date(Date.now() - 1) })
    await scheduler.tickDue()

    expect(log).toContain('cb1:t1')
    expect(log).toContain('cb2:t1')
  })

  it('tickDue with no due timers and no callbacks is a no-op', async () => {
    await scheduler.schedule(makeTimer('t-future', 60_000))
    await expect(scheduler.tickDue()).resolves.toBeUndefined()
    expect(scheduler.getAll()).toHaveLength(1)
  })
})

// ─── popNextDue ───────────────────────────────────────────────────────────────

describe('InMemoryScheduler — popNextDue', () => {
  let scheduler: InMemoryScheduler

  beforeEach(() => {
    vi.useFakeTimers()
    scheduler = new InMemoryScheduler()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null when no timers are due', async () => {
    await scheduler.schedule(makeTimer('t-future', 60_000))
    expect(scheduler.popNextDue()).toBeNull()
  })

  it('returns null when there are no timers at all', () => {
    expect(scheduler.popNextDue()).toBeNull()
  })

  it('returns the earliest due timer and removes it', async () => {
    const now = Date.now()
    await scheduler.schedule({ ...makeTimer('t1', 0), fireAt: new Date(now - 500) })
    await scheduler.schedule({ ...makeTimer('t2', 0), fireAt: new Date(now - 1000) })

    const next = scheduler.popNextDue()
    expect(next?.id).toBe('t2') // t2 fired earlier
    expect(scheduler.getAll().find(t => t.id === 't2')).toBeUndefined()
    expect(scheduler.getAll().find(t => t.id === 't1')).toBeDefined()
  })

  it('does not invoke callbacks — just dequeues', async () => {
    const fired: string[] = []
    scheduler.onTimerFired(async (t) => { fired.push(t.id) })
    await scheduler.schedule({ ...makeTimer('t1', 0), fireAt: new Date(Date.now() - 1) })

    scheduler.popNextDue()
    expect(fired).toHaveLength(0)
  })
})

// ─── start / stop (real timers) ───────────────────────────────────────────────

describe('InMemoryScheduler — start and stop', () => {
  let scheduler: InMemoryScheduler

  beforeEach(() => {
    vi.useFakeTimers()
    scheduler = new InMemoryScheduler()
  })

  afterEach(async () => {
    await scheduler.stop()
    vi.useRealTimers()
  })

  it('start arms timeouts for already-scheduled timers', async () => {
    const fired: string[] = []
    scheduler.onTimerFired(async (t) => { fired.push(t.id) })

    // Schedule before start
    await scheduler.schedule({ ...makeTimer('t1', 0), fireAt: new Date(Date.now() + 100) })
    await scheduler.start()

    vi.advanceTimersByTime(200)
    // Allow microtasks/async to flush
    await Promise.resolve()

    expect(fired).toContain('t1')
  })

  it('schedule after start arms the timeout immediately', async () => {
    const fired: string[] = []
    scheduler.onTimerFired(async (t) => { fired.push(t.id) })

    await scheduler.start()
    await scheduler.schedule({ ...makeTimer('t2', 0), fireAt: new Date(Date.now() + 50) })

    vi.advanceTimersByTime(100)
    await Promise.resolve()

    expect(fired).toContain('t2')
  })

  it('stop clears all pending timeouts so callbacks are not called', async () => {
    const fired: string[] = []
    scheduler.onTimerFired(async (t) => { fired.push(t.id) })

    await scheduler.schedule({ ...makeTimer('t1', 0), fireAt: new Date(Date.now() + 100) })
    await scheduler.start()
    await scheduler.stop()

    vi.advanceTimersByTime(200)
    await Promise.resolve()

    expect(fired).toHaveLength(0)
  })

  it('cancelled timer is not fired even after start and time advance', async () => {
    const fired: string[] = []
    scheduler.onTimerFired(async (t) => { fired.push(t.id) })

    await scheduler.schedule({ ...makeTimer('t1', 0), fireAt: new Date(Date.now() + 50) })
    await scheduler.start()
    await scheduler.cancel('t1')

    vi.advanceTimersByTime(200)
    await Promise.resolve()

    expect(fired).toHaveLength(0)
  })
})

// ─── reset ────────────────────────────────────────────────────────────────────

describe('InMemoryScheduler — reset', () => {
  let scheduler: InMemoryScheduler

  beforeEach(() => {
    vi.useFakeTimers()
    scheduler = new InMemoryScheduler()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reset clears all pending timers', async () => {
    await scheduler.schedule(makeTimer('t1', 5000))
    await scheduler.schedule(makeTimer('t2', 10000))
    scheduler.reset()
    expect(scheduler.getAll()).toHaveLength(0)
  })

  it('reset clears timeout handles so timers are not fired afterwards', async () => {
    const fired: string[] = []
    scheduler.onTimerFired(async (t) => { fired.push(t.id) })

    await scheduler.schedule({ ...makeTimer('t1', 0), fireAt: new Date(Date.now() + 100) })
    await scheduler.start()
    scheduler.reset()

    vi.advanceTimersByTime(200)
    await Promise.resolve()

    expect(fired).toHaveLength(0)
  })
})
