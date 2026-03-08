import type { ScheduledTimer } from '../model/types.js'
import type { Scheduler, TimerFiredCallback } from '../interfaces/Scheduler.js'

export class InMemoryScheduler implements Scheduler {
  private timers = new Map<string, ScheduledTimer>()
  private callbacks: TimerFiredCallback[] = []
  private timeoutHandles = new Map<string, ReturnType<typeof setTimeout>>()
  private running = false

  async schedule(timer: ScheduledTimer): Promise<void> {
    this.timers.set(timer.id, { ...timer })
    if (this.running) {
      this.armTimeout(timer)
    }
  }

  async cancel(timerId: string): Promise<void> {
    this.timers.delete(timerId)
    const handle = this.timeoutHandles.get(timerId)
    if (handle !== undefined) {
      clearTimeout(handle)
      this.timeoutHandles.delete(timerId)
    }
  }

  onTimerFired(callback: TimerFiredCallback): void {
    this.callbacks.push(callback)
  }

  async start(): Promise<void> {
    this.running = true
    for (const timer of this.timers.values()) {
      this.armTimeout(timer)
    }
  }

  async stop(): Promise<void> {
    this.running = false
    for (const handle of this.timeoutHandles.values()) {
      clearTimeout(handle)
    }
    this.timeoutHandles.clear()
  }

  private armTimeout(timer: ScheduledTimer): void {
    const delay = Math.max(0, timer.fireAt.getTime() - Date.now())
    const handle = setTimeout(async () => {
      if (!this.timers.has(timer.id)) return // was cancelled
      this.timers.delete(timer.id)
      this.timeoutHandles.delete(timer.id)
      for (const cb of this.callbacks) {
        await cb(timer)
      }
    }, delay)
    this.timeoutHandles.set(timer.id, handle)
  }

  // ─── Test Helpers ────────────────────────────────────────────────────────────

  /** All pending timers. */
  getAll(): ScheduledTimer[] {
    return [...this.timers.values()]
  }

  /**
   * Immediately fire and remove all timers whose fireAt <= now.
   * Useful with vi.useFakeTimers() — call after vi.advanceTimersByTime().
   */
  async tickDue(): Promise<void> {
    const now = new Date()
    const due = [...this.timers.values()].filter(t => t.fireAt <= now)
    for (const timer of due) {
      this.timers.delete(timer.id)
      for (const cb of this.callbacks) {
        await cb(timer)
      }
    }
  }

  /**
   * Dequeue and return the next due timer without invoking callbacks.
   * Useful for tests that want to construct and apply the resulting command manually.
   */
  popNextDue(): ScheduledTimer | null {
    const now = new Date()
    const due = [...this.timers.values()]
      .filter(t => t.fireAt <= now)
      .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
    const next = due[0] ?? null
    if (next) this.timers.delete(next.id)
    return next
  }

  /** Reset all state. */
  reset(): void {
    for (const handle of this.timeoutHandles.values()) clearTimeout(handle)
    this.timers.clear()
    this.timeoutHandles.clear()
  }
}
