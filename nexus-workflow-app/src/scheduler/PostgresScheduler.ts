import type { ScheduledTimer } from 'nexus-workflow-core'
import type { Scheduler, TimerFiredCallback } from 'nexus-workflow-core'
import type { StateStore } from 'nexus-workflow-core'

// ─── Options ──────────────────────────────────────────────────────────────────

export interface PostgresSchedulerOptions {
  /** How often to poll the DB for due timers, in ms. Default: 5000. */
  pollIntervalMs?: number
}

// ─── PostgresScheduler ────────────────────────────────────────────────────────

/**
 * A `Scheduler` implementation backed by the `StateStore`.
 *
 * Timers are persisted via `store.saveTimer()` / `store.deleteTimer()`.
 * A polling loop queries `store.getDueTimers(now)` on each tick, fires
 * registered callbacks, and deletes each timer before invoking callbacks
 * so that a crash during the callback does not cause a repeated fire on
 * the same instance of the scheduler. A fresh process will re-poll the DB
 * and find no remaining timer — making this effectively at-most-once within
 * a single process lifetime, and at-least-once across process restarts if
 * the store still has the timer (delete happens before callback).
 *
 * For production use the caller's `onTimerFired` callback should be
 * idempotent (issue `FireTimer` — the engine rejects it with a RuntimeError
 * if the token is no longer waiting, which is caught and silently ignored).
 */
export class PostgresScheduler implements Scheduler {
  private readonly store: StateStore
  private readonly pollIntervalMs: number
  private readonly callbacks: TimerFiredCallback[] = []
  private intervalHandle: ReturnType<typeof setInterval> | null = null

  constructor(store: StateStore, options: PostgresSchedulerOptions = {}) {
    this.store = store
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000
  }

  /** Persist a timer so it will be fired when `fireAt` is reached. */
  async schedule(timer: ScheduledTimer): Promise<void> {
    await this.store.saveTimer(timer)
  }

  /** Remove a timer. No-op if it does not exist. */
  async cancel(timerId: string): Promise<void> {
    await this.store.deleteTimer(timerId)
  }

  /** Register a callback to invoke when a due timer is found. */
  onTimerFired(callback: TimerFiredCallback): void {
    this.callbacks.push(callback)
  }

  /**
   * Start the polling loop. Polls immediately on start to fire any timers
   * that became due while the scheduler was stopped (e.g. after a restart).
   * Idempotent — calling `start()` twice has no effect.
   */
  async start(): Promise<void> {
    if (this.intervalHandle !== null) return
    await this.poll()
    this.intervalHandle = setInterval(() => void this.poll(), this.pollIntervalMs)
  }

  /** Stop the polling loop. In-flight poll completes before returning. */
  async stop(): Promise<void> {
    if (this.intervalHandle === null) return
    clearInterval(this.intervalHandle)
    this.intervalHandle = null
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    const due = await this.store.getDueTimers(new Date())
    for (const timer of due) {
      // Delete before firing: idempotency guard within this process lifetime
      await this.store.deleteTimer(timer.id)
      for (const cb of this.callbacks) {
        await cb(timer)
      }
    }
  }
}
