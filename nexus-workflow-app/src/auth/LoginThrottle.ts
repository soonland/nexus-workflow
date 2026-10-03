export interface LoginThrottleOptions {
  /** Failures within `windowMs` that lock a key. */
  maxFailures: number
  windowMs: number
  /** How long a locked key stays locked. */
  lockMs: number
  /** Upper bound on tracked keys, so a flood of made-up emails cannot exhaust memory. Default 10 000. */
  maxKeys?: number
  /** An attempt that never reports back is forgotten after this long. Default 60 000. */
  pendingTtlMs?: number
  /** Injectable clock for tests. */
  now?: () => number
}

export type ThrottleResult = { allowed: true } | { allowed: false; retryAfterSeconds: number }

/**
 * An attempt that was let through and is now in flight. Report how it ended: `fail()` if the
 * credentials were wrong, `release()` if it succeeded or ended for any other reason.
 */
export type BeginResult =
  | { allowed: true; fail(): void; release(): void }
  | { allowed: false; retryAfterSeconds: number }

interface Entry {
  failures: number[]
  /** Start times of attempts let through that have not reported back yet. */
  pending: number[]
  lockedUntil: number
}

/**
 * Counts failed sign-ins per key (an account, an IP address) and locks a key that fails too often.
 * Unknown accounts are tracked exactly like real ones, so locking reveals nothing about which
 * emails exist. State is in memory: it is per process and resets on restart, which is acceptable
 * for a single instance.
 *
 * Two properties matter against an attacker who controls the input:
 *  - Attempts in flight take up capacity (`begin`). Password checking is slow, so checking only
 *    recorded failures would let a burst of parallel requests all pass before any of them had
 *    failed. A key admits at most `maxFailures` minus (failures + attempts in flight) more
 *    attempts; a failure is recorded when it is confirmed, and a success never counts as one.
 *  - A lock is never evicted to make room. When the table is full the unlocked entries go first;
 *    if every slot holds an active lock, new keys are refused instead (fail closed) until some
 *    lock expires. Otherwise flooding the table with made-up emails would free the key being attacked.
 */
export class LoginThrottle {
  private readonly entries = new Map<string, Entry>()
  private readonly maxKeys: number
  private readonly pendingTtlMs: number
  private readonly now: () => number

  constructor(private readonly options: LoginThrottleOptions) {
    this.maxKeys = options.maxKeys ?? 10_000
    this.pendingTtlMs = options.pendingTtlMs ?? 60_000
    this.now = options.now ?? Date.now
  }

  /** Whether one more attempt may start now: not locked, and not already at the limit counting attempts in flight. */
  check(key: string): ThrottleResult {
    const now = this.now()
    const entry = this.entries.get(key)
    if (entry) {
      const remaining = entry.lockedUntil - now
      if (remaining > 0) return { allowed: false, retryAfterSeconds: Math.ceil(remaining / 1000) }
      const inFlight = this.activeFailures(entry, now) + this.activePending(entry, now)
      // Out of capacity only because of attempts still running: they settle within moments
      if (inFlight >= this.options.maxFailures) return { allowed: false, retryAfterSeconds: 1 }
      return { allowed: true }
    }
    // An untracked key can only be admitted if there is, or can be made, room for it
    if (this.entries.size >= this.maxKeys && !this.canMakeRoom(now)) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((this.earliestUnlock() - now) / 1000)) }
    }
    return { allowed: true }
  }

  /**
   * Starts an attempt: checks the key and, if it may proceed, reserves capacity for it until it
   * reports back. Synchronous, so nothing can interleave between the check and the reservation.
   */
  begin(key: string): BeginResult {
    const blocked = this.check(key)
    if (!blocked.allowed) return blocked

    const now = this.now()
    let entry = this.entries.get(key)
    if (!entry) {
      if (!this.makeRoom(now)) return { allowed: false, retryAfterSeconds: 1 }
      entry = { failures: [], pending: [], lockedUntil: 0 }
      this.entries.set(key, entry)
    }
    entry.pending.push(now)

    const settle = (): void => {
      const current = this.entries.get(key)
      const index = current?.pending.indexOf(now) ?? -1
      if (current && index !== -1) current.pending.splice(index, 1)
    }
    return {
      allowed: true,
      fail: () => {
        settle()
        this.addFailure(key)
      },
      release: settle,
    }
  }

  recordFailure(key: string): void {
    this.addFailure(key)
  }

  /** A good sign-in clears the failures of the key (but never lifts a lock already in force). */
  recordSuccess(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    if (entry.lockedUntil > this.now()) return
    entry.failures = []
    // Attempts still in flight keep their reservation
    if (this.activePending(entry, this.now()) === 0) this.entries.delete(key)
  }

  size(): number {
    return this.entries.size
  }

  // ─── private ───────────────────────────────────────────────────────────────

  private addFailure(key: string): void {
    const now = this.now()
    let entry = this.entries.get(key)
    if (!entry) {
      if (!this.makeRoom(now)) return
      entry = { failures: [], pending: [], lockedUntil: 0 }
      this.entries.set(key, entry)
    }
    entry.failures = entry.failures.filter((at) => now - at < this.options.windowMs)
    entry.failures.push(now)
    if (entry.failures.length >= this.options.maxFailures) {
      entry.lockedUntil = now + this.options.lockMs
      entry.failures = [] // the next run of failures starts from zero once the lock ends
    }
  }

  private isLocked(entry: Entry, now: number): boolean {
    return entry.lockedUntil > now
  }

  private activeFailures(entry: Entry, now: number): number {
    return entry.failures.filter((at) => now - at < this.options.windowMs).length
  }

  private activePending(entry: Entry, now: number): number {
    return entry.pending.filter((at) => now - at < this.pendingTtlMs).length
  }

  private isStale(entry: Entry, now: number): boolean {
    return !this.isLocked(entry, now) && this.activeFailures(entry, now) === 0 && this.activePending(entry, now) === 0
  }

  private canMakeRoom(now: number): boolean {
    for (const entry of this.entries.values()) {
      if (!this.isLocked(entry, now)) return true
    }
    return false
  }

  private earliestUnlock(): number {
    let earliest = Number.POSITIVE_INFINITY
    for (const entry of this.entries.values()) earliest = Math.min(earliest, entry.lockedUntil)
    return earliest
  }

  /** Frees a slot if the table is full: stale entries first, then the oldest unlocked ones. Never a lock. */
  private makeRoom(now: number): boolean {
    if (this.entries.size < this.maxKeys) return true
    for (const [key, entry] of this.entries) {
      if (this.isStale(entry, now)) this.entries.delete(key)
    }
    for (const [key, entry] of this.entries) {
      if (this.entries.size < this.maxKeys) break
      if (!this.isLocked(entry, now)) this.entries.delete(key) // Map iterates in insertion order: oldest first
    }
    return this.entries.size < this.maxKeys
  }
}
