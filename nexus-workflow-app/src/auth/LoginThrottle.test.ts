import { describe, it, expect, beforeEach } from 'vitest'
import { LoginThrottle } from './LoginThrottle.js'

describe('LoginThrottle', () => {
  let now: number
  let throttle: LoginThrottle
  const MIN = 60_000

  beforeEach(() => {
    now = 1_000_000
    throttle = new LoginThrottle({ maxFailures: 3, windowMs: 10 * MIN, lockMs: 5 * MIN, now: () => now })
  })

  const fail = (key: string, times = 1) => {
    for (let i = 0; i < times; i++) throttle.recordFailure(key)
  }

  it('allows attempts until the failure limit is reached', () => {
    fail('a', 2)
    expect(throttle.check('a')).toEqual({ allowed: true })
  })

  it('locks a key after the limit and says how long to wait', () => {
    fail('a', 3)

    const result = throttle.check('a')

    expect(result.allowed).toBe(false)
    expect(result).toMatchObject({ retryAfterSeconds: 300 })
  })

  it('counts the wait down and unlocks when the lock has passed', () => {
    fail('a', 3)

    now += 4 * MIN
    expect(throttle.check('a')).toMatchObject({ allowed: false, retryAfterSeconds: 60 })

    now += MIN
    expect(throttle.check('a')).toEqual({ allowed: true })
  })

  it('starts counting from zero after a lock expires', () => {
    fail('a', 3)
    now += 5 * MIN

    fail('a', 2)

    expect(throttle.check('a')).toEqual({ allowed: true })
    fail('a', 1)
    expect(throttle.check('a').allowed).toBe(false)
  })

  it('forgets failures that are older than the window', () => {
    fail('a', 2)
    now += 11 * MIN

    fail('a', 2)

    expect(throttle.check('a')).toEqual({ allowed: true })
  })

  it('keeps keys independent', () => {
    fail('a', 3)
    expect(throttle.check('b')).toEqual({ allowed: true })
  })

  it('a success clears the failures of that key', () => {
    fail('a', 2)
    throttle.recordSuccess('a')

    fail('a', 2)

    expect(throttle.check('a')).toEqual({ allowed: true })
  })

  it('a success does not lift a lock that is already in force', () => {
    fail('a', 3)
    throttle.recordSuccess('a')
    expect(throttle.check('a').allowed).toBe(false)
  })

  it('treats unknown keys like any other, so unknown accounts are throttled the same way', () => {
    fail('nobody@example.com', 3)
    expect(throttle.check('nobody@example.com').allowed).toBe(false)
  })

  describe('begin (attempts in flight take up capacity)', () => {
    it('lets through no more concurrent attempts than there are failures left, so a burst cannot all slip past the check', () => {
      const results = [throttle.begin('a'), throttle.begin('a'), throttle.begin('a'), throttle.begin('a'), throttle.begin('a')]

      expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false])
    })

    it('counts failures already recorded against the capacity', () => {
      fail('a', 2)

      expect([throttle.begin('a').allowed, throttle.begin('a').allowed]).toEqual([true, false])
    })

    it('a failed attempt counts as a failure and, at the limit, locks the key', () => {
      const attempts = [throttle.begin('a'), throttle.begin('a'), throttle.begin('a')]

      attempts.forEach((a) => a.allowed && a.fail())

      expect(throttle.check('a')).toMatchObject({ allowed: false, retryAfterSeconds: 300 })
    })

    it('a success on the last allowed attempt does not lock the key (it was never a failure)', () => {
      fail('a', 2)
      const third = throttle.begin('a')
      if (!third.allowed) throw new Error('expected the third attempt to be allowed')

      third.release()

      expect(throttle.check('a')).toEqual({ allowed: true })
      expect(throttle.begin('a').allowed).toBe(true)
    })

    it('releasing an attempt (success or a server error) frees its capacity without recording a failure', () => {
      const a = throttle.begin('a')
      throttle.begin('a')
      throttle.begin('a')
      expect(throttle.begin('a').allowed).toBe(false)
      if (!a.allowed) throw new Error('expected the first attempt to be allowed')

      a.release()

      expect(throttle.begin('a').allowed).toBe(true)
    })

    it('forgets an attempt that never reports back, so a crashed request cannot hold capacity forever', () => {
      throttle.begin('a')
      throttle.begin('a')
      throttle.begin('a')
      expect(throttle.begin('a').allowed).toBe(false)

      now += 2 * MIN

      expect(throttle.begin('a').allowed).toBe(true)
    })

    it('is blocked, and records nothing, while the key is locked', () => {
      fail('a', 3)

      expect(throttle.begin('a')).toMatchObject({ allowed: false })

      now += 5 * MIN
      expect(throttle.begin('a').allowed).toBe(true)
      expect(throttle.begin('a').allowed).toBe(true)
      expect(throttle.begin('a').allowed).toBe(true) // the blocked attempt left no trace: still three allowed
    })

    it('a success clears the failures but keeps the reservations of attempts still in flight', () => {
      throttle.recordFailure('a')
      const inFlight = [throttle.begin('a'), throttle.begin('a')]
      expect(inFlight.every((a) => a.allowed)).toBe(true)

      throttle.recordSuccess('a') // some other request from the same place just succeeded

      // failures forgiven (the one above), the two attempts in flight still hold their capacity
      expect(throttle.begin('a').allowed).toBe(true)
      expect(throttle.begin('a').allowed).toBe(false)
    })

    it('tolerates settling an attempt whose entry was evicted meanwhile', () => {
      const t = new LoginThrottle({ maxFailures: 3, windowMs: 10 * MIN, lockMs: 5 * MIN, maxKeys: 2, now: () => now })
      const a = t.begin('victim')
      t.recordFailure('x')
      t.recordFailure('y')
      t.recordFailure('z')
      if (!a.allowed) throw new Error('expected the attempt to be allowed')

      expect(() => a.fail()).not.toThrow()
      expect(() => a.release()).not.toThrow()
    })
  })

  describe('capacity: a flood of new keys must never push out a lock', () => {
    const small = () => new LoginThrottle({ maxFailures: 1, windowMs: 10 * MIN, lockMs: 5 * MIN, maxKeys: 10, now: () => now })

    it('evicts unlocked entries before it would touch a lock', () => {
      const t = small()
      t.recordFailure('victim') // maxFailures 1: locked immediately
      expect(t.check('victim').allowed).toBe(false)

      for (let i = 0; i < 500; i++) t.recordFailure(`flood${i}`)

      expect(t.check('victim').allowed).toBe(false)
      expect(t.size()).toBeLessThanOrEqual(10)
    })

    it('keeps partial failure counts of the keys it can, but drops those before locks', () => {
      const t = new LoginThrottle({ maxFailures: 3, windowMs: 10 * MIN, lockMs: 5 * MIN, maxKeys: 5, now: () => now })
      t.recordFailure('p1')
      t.recordFailure('p2') // partial counts, not locked
      for (let i = 0; i < 3; i++) t.recordFailure('locked')

      for (let i = 0; i < 20; i++) t.recordFailure(`flood${i}`)

      expect(t.check('locked').allowed).toBe(false)
    })

    it('when every slot holds an active lock, new keys are refused rather than a lock being dropped', () => {
      const t = small()
      for (let i = 0; i < 10; i++) t.recordFailure(`locked${i}`)
      expect(t.size()).toBe(10)

      const result = t.check('newcomer')

      expect(result).toMatchObject({ allowed: false })
      expect(t.begin('newcomer')).toMatchObject({ allowed: false })
      expect(t.size()).toBe(10)
      for (let i = 0; i < 10; i++) expect(t.check(`locked${i}`).allowed).toBe(false)
    })

    it('goes back to tracking new keys once locks expire', () => {
      const t = small()
      for (let i = 0; i < 10; i++) t.recordFailure(`locked${i}`)

      now += 6 * MIN

      expect(t.check('newcomer')).toEqual({ allowed: true })
      expect(t.begin('newcomer').allowed).toBe(true) // this attempt is let through and counted...
      expect(t.check('newcomer').allowed).toBe(false) // ...and with maxFailures 1 that locks the key: it is tracked
    })
  })

  it('does not grow without bound when many different keys fail', () => {
    const small = new LoginThrottle({ maxFailures: 3, windowMs: MIN, lockMs: MIN, maxKeys: 50, now: () => now })
    for (let i = 0; i < 500; i++) small.recordFailure(`k${i}`)
    expect(small.size()).toBeLessThanOrEqual(50)
  })

  it('drops entries that have expired when it makes room', () => {
    const small = new LoginThrottle({ maxFailures: 3, windowMs: MIN, lockMs: MIN, maxKeys: 10, now: () => now })
    for (let i = 0; i < 10; i++) small.recordFailure(`old${i}`)
    now += 2 * MIN

    small.recordFailure('fresh')

    expect(small.size()).toBe(1)
  })
})
