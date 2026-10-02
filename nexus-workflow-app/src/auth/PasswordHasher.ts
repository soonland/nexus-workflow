import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

export const MIN_PASSWORD_LENGTH = 12
const MAX_PASSWORD_LENGTH = 1024 // longer is only a way to make the server burn CPU
const KEY_LENGTH = 64
const SALT_LENGTH = 16

/** Raised when a password breaks the policy (too short or too long). The message is safe to show. */
export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PasswordPolicyError'
  }
}

export interface ScryptParams {
  /** CPU/memory cost, a power of two. Memory used is about 128 * N * r bytes. */
  N: number
  r: number
  p: number
}

// N=2^15, r=8, p=1: about 32 MiB and tens of milliseconds per hash. Raise N as hardware allows;
// hashes carry their own parameters, so old ones keep verifying (see needsRehash).
const DEFAULT_PARAMS: ScryptParams = { N: 32768, r: 8, p: 1 }

// Upper bounds on parameters read back from a stored hash, so a corrupted or hostile row cannot
// make verification allocate gigabytes.
const MIN_N = 1024
const MAX_N = 2 ** 17
const MAX_R = 16
const MAX_P = 4

interface ParsedHash extends ScryptParams {
  salt: Buffer
  hash: Buffer
}

function derive(password: string, salt: Buffer, { N, r, p }: ScryptParams, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Node refuses to run if maxmem is not comfortably above the 128*N*r the algorithm needs
    scrypt(password, salt, keyLength, { N, r, p, maxmem: 256 * N * r }, (err, key) => {
      if (err) reject(err)
      else resolve(key)
    })
  })
}

function parse(stored: string): ParsedHash | null {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null
  const [, n, r, p, salt, hash] = parts as [string, string, string, string, string, string]
  const params = { N: Number(n), r: Number(r), p: Number(p) }
  const numeric = [n, r, p].every((v) => /^\d+$/.test(v))
  const powerOfTwo = Number.isInteger(params.N) && (params.N & (params.N - 1)) === 0
  if (!numeric || !powerOfTwo) return null
  if (params.N < MIN_N || params.N > MAX_N || params.r < 1 || params.r > MAX_R || params.p < 1 || params.p > MAX_P) return null
  const saltBuf = Buffer.from(salt, 'base64')
  const hashBuf = Buffer.from(hash, 'base64')
  if (saltBuf.length === 0 || hashBuf.length === 0) return null
  return { ...params, salt: saltBuf, hash: hashBuf }
}

/**
 * Password hashing with scrypt (Node's built-in, no native dependency).
 *
 * Hashes look like `scrypt$N$r$p$<salt>$<hash>` (base64) and carry their own parameters, so they
 * can be strengthened later without invalidating existing passwords. Passwords are Unicode
 * NFKC-normalised first so the same password typed on different systems matches.
 */
export class PasswordHasher {
  private readonly params: ScryptParams

  constructor(params: Partial<ScryptParams> = {}) {
    this.params = { ...DEFAULT_PARAMS, ...params }
  }

  /** Hash a new password. Throws PasswordPolicyError if it is not acceptable. */
  async hash(password: string): Promise<string> {
    const normalized = this.checkPolicy(password)
    const salt = randomBytes(SALT_LENGTH)
    const key = await derive(normalized, salt, this.params, KEY_LENGTH)
    const { N, r, p } = this.params
    return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`
  }

  /**
   * Check a password against a stored hash. Never throws for bad input: a wrong password, a
   * password outside the policy, a malformed hash and a missing hash (`null`: unknown account, or
   * one that has no password yet) all return false. The missing/malformed case still performs a
   * full scrypt run, so the response time does not reveal whether an account exists.
   */
  async verify(password: string, stored: string | null): Promise<boolean> {
    const parsed = stored === null ? null : parse(stored)
    if (!parsed) {
      await derive(password.normalize('NFKC').slice(0, MAX_PASSWORD_LENGTH), DUMMY_SALT, this.params, KEY_LENGTH)
      return false
    }
    if (!this.withinPolicy(password)) return false

    const key = await derive(password.normalize('NFKC'), parsed.salt, parsed, parsed.hash.length)
    return key.length === parsed.hash.length && timingSafeEqual(key, parsed.hash)
  }

  /** True if the hash was made with weaker parameters than the current ones (or is unreadable). */
  needsRehash(stored: string): boolean {
    const parsed = parse(stored)
    if (!parsed) return true
    return parsed.N < this.params.N || parsed.r < this.params.r || parsed.p < this.params.p
  }

  private withinPolicy(password: string): boolean {
    const length = [...password.normalize('NFKC')].length
    return length >= MIN_PASSWORD_LENGTH && length <= MAX_PASSWORD_LENGTH
  }

  private checkPolicy(password: string): string {
    const normalized = password.normalize('NFKC')
    const length = [...normalized].length // characters, not UTF-16 units or bytes
    if (length < MIN_PASSWORD_LENGTH) {
      throw new PasswordPolicyError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`)
    }
    if (length > MAX_PASSWORD_LENGTH) {
      throw new PasswordPolicyError(`Password must be at most ${MAX_PASSWORD_LENGTH} characters long`)
    }
    return normalized
  }
}

const DUMMY_SALT = Buffer.alloc(SALT_LENGTH, 7)
