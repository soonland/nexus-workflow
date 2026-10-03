export interface LoginThrottleOptions {
  /** Failures within `windowMs` that lock a key. */
  maxFailures: number
  windowMs: number
  /** How long a locked key stays locked. */
  lockMs: number
  /** Upper bound on tracked keys, so a flood of made-up emails cannot exhaust memory. Default 10 000. */
  maxKeys?: number
  /** Injectable clock for tests. */
  now?: () => number
}

export type ThrottleResult = { allowed: true } | { allowed: false; retryAfterSeconds: number }

interface Entry {
  failures: number[]
  lockedUntil: number
}

/**
 * Counts failed sign-ins per key (an account, an IP address) and locks a key that fails too often.
 * Unknown accounts are tracked exactly like real ones, so locking reveals nothing about which
 * emails exist. State is in memory: it is per process and resets on restart, which is acceptable
 * for a single instance.
 */
export class LoginThrottle {
  private readonly entries = new Map<string, Entry>()
  private readonly maxKeys: number
  private readonly now: () => number

  constructor(private readonly options: LoginThrottleOptions) {
    this.maxKeys = options.maxKeys ?? 10_000
    this.now = options.now ?? Date.now
  }

  check(key: string): ThrottleResult {
    const entry = this.entries.get(key)
    if (!entry) return { allowed: true }
    const remaining = entry.lockedUntil - this.now()
    if (remaining <= 0) return { allowed: true }
    return { allowed: false, retryAfterSeconds: Math.ceil(remaining / 1000) }
  }

  recordFailure(key: string): void {
    const now = this.now()
    let entry = this.entries.get(key)
    if (!entry) {
      this.makeRoom(now)
      entry = { failures: [], lockedUntil: 0 }
      this.entries.set(key, entry)
    }
    entry.failures = entry.failures.filter((at) => now - at < this.options.windowMs)
    entry.failures.push(now)
    if (entry.failures.length >= this.options.maxFailures) {
      entry.lockedUntil = now + this.options.lockMs
      entry.failures = [] // the next run of failures starts from zero once the lock ends
    }
  }

  /** A good sign-in clears the failures of the key (but never lifts a lock already in force). */
  recordSuccess(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    if (entry.lockedUntil > this.now()) return
    this.entries.delete(key)
  }

  size(): number {
    return this.entries.size
  }

  private makeRoom(now: number): void {
    if (this.entries.size < this.maxKeys) return
    for (const [key, entry] of this.entries) {
      const stale = entry.lockedUntil <= now && entry.failures.every((at) => now - at >= this.options.windowMs)
      if (stale) this.entries.delete(key)
    }
    // Still full: drop the oldest entries (Map iterates in insertion order)
    for (const key of this.entries.keys()) {
      if (this.entries.size < this.maxKeys) break
      this.entries.delete(key)
    }
  }
}
