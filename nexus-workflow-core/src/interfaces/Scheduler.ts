import type { ScheduledTimer } from '../model/types.js'

export interface TimerFiredCallback {
  (timer: ScheduledTimer): Promise<void>
}

export interface Scheduler {
  /** Schedule a timer to fire at a specific instant. */
  schedule(timer: ScheduledTimer): Promise<void>

  /** Cancel a previously scheduled timer. No-op if not found. */
  cancel(timerId: string): Promise<void>

  /** Register a callback to be invoked when any timer fires. */
  onTimerFired(callback: TimerFiredCallback): void

  /** Start the scheduler (begin polling / listening). */
  start(): Promise<void>

  /** Stop the scheduler gracefully. */
  stop(): Promise<void>
}
