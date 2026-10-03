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
