import { describe, it, expect } from 'vitest'
import { PasswordHasher, PasswordPolicyError, MIN_PASSWORD_LENGTH } from './PasswordHasher.js'

// A cheap cost keeps the suite fast; the defaults are exercised in their own tests below.
const fast = new PasswordHasher({ N: 1024, r: 8, p: 1 })
const GOOD = 'correct horse battery staple'

describe('PasswordHasher', () => {
  describe('hash', () => {
    it('produces a self-describing scrypt hash that does not contain the password', async () => {
      const hash = await fast.hash(GOOD)

      expect(hash).toMatch(/^scrypt\$1024\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
      expect(hash).not.toContain(GOOD)
    })

    it('uses a fresh random salt, so the same password hashes differently each time', async () => {
      const [a, b] = await Promise.all([fast.hash(GOOD), fast.hash(GOOD)])
      expect(a).not.toBe(b)
    })

    it('uses the default parameters (N=2^15, r=8, p=1) unless told otherwise', async () => {
      const hash = await new PasswordHasher().hash(GOOD)
      expect(hash.startsWith('scrypt$32768$8$1$')).toBe(true)
    })
  })

  describe('password policy', () => {
    it(`rejects passwords shorter than ${MIN_PASSWORD_LENGTH} characters`, async () => {
      await expect(fast.hash('a'.repeat(MIN_PASSWORD_LENGTH - 1))).rejects.toBeInstanceOf(PasswordPolicyError)
      await expect(fast.hash('a'.repeat(MIN_PASSWORD_LENGTH))).resolves.toBeTypeOf('string')
    })

    it('rejects absurdly long passwords (they would be a cheap way to burn CPU)', async () => {
      await expect(fast.hash('a'.repeat(1025))).rejects.toBeInstanceOf(PasswordPolicyError)
    })

    it('counts characters, not bytes', async () => {
      // 12 emoji are 12 characters (48 bytes)
      await expect(fast.hash('🔑'.repeat(MIN_PASSWORD_LENGTH))).resolves.toBeTypeOf('string')
    })

    it('does not trim: passwords made of spaces are valid if long enough', async () => {
      await expect(fast.hash(' '.repeat(MIN_PASSWORD_LENGTH))).resolves.toBeTypeOf('string')
    })
  })

  describe('verify', () => {
    it('accepts the right password and rejects a wrong one', async () => {
      const hash = await fast.hash(GOOD)

      expect(await fast.verify(GOOD, hash)).toBe(true)
      expect(await fast.verify(GOOD + 'x', hash)).toBe(false)
      expect(await fast.verify('', hash)).toBe(false)
    })

    it('treats canonically-equivalent Unicode as the same password (NFKC)', async () => {
      const composed = 'café-au-lait-2026' // é as one character
      const decomposed = 'café-au-lait-2026' // e + combining accent
      const hash = await fast.hash(composed)

      expect(await fast.verify(decomposed, hash)).toBe(true)
    })

    it('verifies against the parameters stored in the hash, not the current ones', async () => {
      const cheap = new PasswordHasher({ N: 1024, r: 8, p: 1 })
      const stronger = new PasswordHasher({ N: 2048, r: 8, p: 1 })
      const oldHash = await cheap.hash(GOOD)

      expect(await stronger.verify(GOOD, oldHash)).toBe(true)
    })

    it.each([
      ['an empty string', ''],
      ['garbage', 'not-a-hash'],
      ['an unknown scheme', 'bcrypt$12$abc$def'],
      ['too few parts', 'scrypt$1024$8$1$abc'],
      ['non-numeric parameters', 'scrypt$x$8$1$YWJj$YWJj'],
      ['an invalid N (not a power of two)', 'scrypt$1000$8$1$YWJj$YWJj'],
      ['an excessive N that would exhaust memory', 'scrypt$1073741824$8$1$YWJj$YWJj'],
    ])('returns false, without throwing, for %s', async (_label, hash) => {
      await expect(fast.verify(GOOD, hash)).resolves.toBe(false)
    })

    it('returns false for a user that has no password yet (null hash)', async () => {
      await expect(fast.verify(GOOD, null)).resolves.toBe(false)
    })

    it('never throws on a password that violates the policy; it simply does not match', async () => {
      const hash = await fast.hash(GOOD)
      await expect(fast.verify('short', hash)).resolves.toBe(false)
      await expect(fast.verify('a'.repeat(5000), hash)).resolves.toBe(false)
    })
  })

  describe('timing of unknown accounts', () => {
    const timeIt = async (fn: () => Promise<unknown>) => {
      const start = performance.now()
      await fn()
      return performance.now() - start
    }
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!

    it('does the same work for a missing password hash as for a real one, so login time does not reveal which emails exist', async () => {
      const hasher = new PasswordHasher({ N: 16384, r: 8, p: 1 })
      const hash = await hasher.hash(GOOD)
      await hasher.verify(GOOD, hash) // warm up

      const wrong: number[] = []
      const unknown: number[] = []
      for (let i = 0; i < 5; i++) {
        wrong.push(await timeIt(() => hasher.verify('wrong password here', hash)))
        unknown.push(await timeIt(() => hasher.verify('wrong password here', null)))
      }

      // Same order of magnitude; a skipped scrypt would be ~100x faster
      expect(median(unknown)).toBeGreaterThan(median(wrong) * 0.4)
      expect(median(unknown)).toBeLessThan(median(wrong) * 2.5)
    })
  })

  describe('needsRehash', () => {
    it('is false for a hash made with the current parameters', async () => {
      expect(fast.needsRehash(await fast.hash(GOOD))).toBe(false)
    })

    it('is true when the stored parameters are weaker than the current ones, or the hash is unreadable', async () => {
      const stronger = new PasswordHasher({ N: 2048, r: 8, p: 1 })
      expect(stronger.needsRehash(await fast.hash(GOOD))).toBe(true)
      expect(stronger.needsRehash('garbage')).toBe(true)
    })
  })
})
