import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Hono } from 'hono'
import postgres from 'postgres'
import { PasswordHasher } from '../auth/PasswordHasher.js'
import { LoginThrottle } from '../auth/LoginThrottle.js'
import { runMigrations } from '../db/migrate.js'
import { SessionStore } from '../db/SessionStore.js'
import { UserStore, type User } from '../db/UserStore.js'
import { createAuthRouter } from './auth.js'

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'
const PASSWORD = 'correct horse battery staple'
const MINUTE = 60_000

describe('auth HTTP API (Postgres)', () => {
  const prefix = `au_${crypto.randomUUID().slice(0, 6)}`
  const email = (name: string) => `${prefix}.${name}@example.com`
  let sql: postgres.Sql
  let users: UserStore
  let sessions: SessionStore
  let hasher: PasswordHasher
  let now: number
  let app: Hono
  let ada: User

  beforeAll(async () => {
    await runMigrations(DATABASE_URL)
    sql = postgres(DATABASE_URL)
    users = new UserStore(sql)
    sessions = new SessionStore(sql, { hmacSecret: 'auth-test-secret', idleMs: 30 * MINUTE, maxMs: 24 * 60 * MINUTE })
    hasher = new PasswordHasher({ N: 1024, r: 8, p: 1 })
    ada = await users.createUser({ email: email('ada'), name: 'Ada', passwordHash: await hasher.hash(PASSWORD) })
    await users.addMembership(ada.id, 'operator', null)
  })

  afterAll(async () => {
    await sql`DELETE FROM public.users WHERE email LIKE ${prefix + '.%'}`
    await sql.end()
  })

  beforeEach(() => {
    now = 1_000_000
    app = new Hono()
    app.route(
      '/auth',
      createAuthRouter({
        users,
        sessions,
        hasher,
        accountIpThrottle: new LoginThrottle({ maxFailures: 3, windowMs: 15 * MINUTE, lockMs: 10 * MINUTE, now: () => now }),
        accountThrottle: new LoginThrottle({ maxFailures: 8, windowMs: 15 * MINUTE, lockMs: 10 * MINUTE, now: () => now }),
        ipThrottle: new LoginThrottle({ maxFailures: 10, windowMs: 15 * MINUTE, lockMs: 10 * MINUTE, now: () => now }),
        sessionMaxAgeSeconds: 24 * 60 * 60,
        trustedProxies: 0,
      }),
    )
  })

  /** An app behind `proxies` trusted proxies, so each request can claim its own client address. */
  function appBehindProxy(proxies = 1, ipLimit = 100) {
    const proxied = new Hono()
    proxied.route(
      '/auth',
      createAuthRouter({
        users, sessions, hasher,
        accountIpThrottle: new LoginThrottle({ maxFailures: 3, windowMs: 15 * MINUTE, lockMs: 10 * MINUTE, now: () => now }),
        accountThrottle: new LoginThrottle({ maxFailures: 8, windowMs: 15 * MINUTE, lockMs: 10 * MINUTE, now: () => now }),
        ipThrottle: new LoginThrottle({ maxFailures: ipLimit, windowMs: 15 * MINUTE, lockMs: 10 * MINUTE, now: () => now }),
        sessionMaxAgeSeconds: 3600,
        trustedProxies: proxies,
      }),
    )
    return (ip: string, body: unknown) =>
      proxied.fetch(
        new Request(url('/auth/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Nexus-Console': '1', Origin: 'http://localhost', 'X-Forwarded-For': ip },
          body: JSON.stringify(body),
        }),
      )
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  const url = (path: string) => `http://localhost${path}`
  const SAME_SITE = { 'X-Nexus-Console': '1', Origin: 'http://localhost' }

  const send = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    app.fetch(
      new Request(url(path), {
        method: init.method ?? 'GET',
        headers: { 'Content-Type': 'application/json', ...init.headers },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      }),
    )

  const login = (body: unknown, headers: Record<string, string> = SAME_SITE) => send('/auth/login', { method: 'POST', body, headers })

  const cookieOf = (res: Response) => {
    const header = res.headers.get('set-cookie') ?? ''
    return { header, value: /nexus_session=([^;]*)/.exec(header)?.[1] ?? '' }
  }

  async function signIn(): Promise<string> {
    const res = await login({ email: email('ada'), password: PASSWORD })
    expect(res.status).toBe(200)
    return cookieOf(res).value
  }

  const withCookie = (token: string, extra: Record<string, string> = {}) => ({ Cookie: `nexus_session=${token}`, ...extra })

  // ─── login ─────────────────────────────────────────────────────────────────

  describe('POST /auth/login', () => {
    it('signs in with the right credentials: returns the user and memberships, never the hash', async () => {
      const res = await login({ email: email('ada'), password: PASSWORD })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.user).toMatchObject({ id: ada.id, email: email('ada'), name: 'Ada' })
      expect(body.memberships).toEqual([expect.objectContaining({ role: 'operator', tenantId: null })])
      expect(JSON.stringify(body)).not.toMatch(/scrypt|password_?hash|passwordHash/i)
      expect(res.headers.get('cache-control')).toBe('no-store')
    })

    it('treats the email case-insensitively', async () => {
      const res = await login({ email: `  ${email('ada').toUpperCase()} `, password: PASSWORD })
      expect(res.status).toBe(200)
    })

    it('sets a hardened session cookie that is not the stored value', async () => {
      const res = await login({ email: email('ada'), password: PASSWORD })
      const { header, value } = cookieOf(res)

      expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(header).toMatch(/HttpOnly/i)
      expect(header).toMatch(/SameSite=Strict/i)
      expect(header).toMatch(/Path=\//i)
      expect(header).toMatch(/Max-Age=86400/i)
      expect(header).not.toMatch(/Secure/i) // plain http in this test
      const stored = (await sql<{ token_hash: string }[]>`SELECT token_hash FROM public.sessions WHERE user_id = ${ada.id}`).map((r) => r.token_hash)
      expect(stored).not.toContain(value)
    })

    it('marks the cookie Secure when the request came over HTTPS (also behind a trusted proxy)', async () => {
      const direct = await app.fetch(
        new Request('https://console.example.com/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Nexus-Console': '1', Origin: 'https://console.example.com' },
          body: JSON.stringify({ email: email('ada'), password: PASSWORD }),
        }),
      )
      expect(cookieOf(direct).header).toMatch(/Secure/i)

      const proxied = new Hono()
      proxied.route(
        '/auth',
        createAuthRouter({
          users, sessions, hasher,
          accountIpThrottle: new LoginThrottle({ maxFailures: 3, windowMs: MINUTE, lockMs: MINUTE }),
          accountThrottle: new LoginThrottle({ maxFailures: 8, windowMs: MINUTE, lockMs: MINUTE }),
          ipThrottle: new LoginThrottle({ maxFailures: 10, windowMs: MINUTE, lockMs: MINUTE }),
          sessionMaxAgeSeconds: 3600,
          trustedProxies: 1,
        }),
      )
      const behindProxy = await proxied.fetch(
        new Request(url('/auth/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Nexus-Console': '1', Origin: 'http://localhost', 'X-Forwarded-Proto': 'https' },
          body: JSON.stringify({ email: email('ada'), password: PASSWORD }),
        }),
      )
      expect(cookieOf(behindProxy).header).toMatch(/Secure/i)
    })

    it('records the sign-in on the user', async () => {
      await login({ email: email('ada'), password: PASSWORD })
      expect((await users.findById(ada.id))?.lastLoginAt).toBeInstanceOf(Date)
    })

    it('gives every sign-in a new session and retires the one the browser presented (no fixation)', async () => {
      const first = await signIn()

      const res = await login({ email: email('ada'), password: PASSWORD }, { ...SAME_SITE, ...withCookie(first) })
      const second = cookieOf(res).value

      expect(second).not.toBe(first)
      expect(await sessions.resolve(first)).toBeNull()
      expect(await sessions.resolve(second)).not.toBeNull()
    })

    it('gives the same answer for a wrong password, an unknown email and a user without a password', async () => {
      await users.createUser({ email: email('nopw'), name: 'No Password' })
      const answers = await Promise.all([
        login({ email: email('ada'), password: 'definitely not the password' }),
        login({ email: email('nobody'), password: PASSWORD }),
        login({ email: email('nopw'), password: PASSWORD }),
      ])

      for (const res of answers) expect(res.status).toBe(401)
      const bodies = await Promise.all(answers.map((r) => r.json()))
      expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1)
      expect(bodies[0]).toMatchObject({ error: 'INVALID_CREDENTIALS' })
      for (const res of answers) expect(res.headers.get('set-cookie')).toBeNull()
    })

    it('rejects a disabled user with the same generic answer, even with the right password', async () => {
      const grace = await users.createUser({ email: email('grace'), name: 'Grace', passwordHash: await hasher.hash(PASSWORD) })
      await users.setStatus(grace.id, 'disabled')

      const res = await login({ email: email('grace'), password: PASSWORD })

      expect(res.status).toBe(401)
      expect(await res.json()).toMatchObject({ error: 'INVALID_CREDENTIALS' })
    })

    it.each([
      ['no body fields', {}],
      ['a non-string email', { email: 5, password: PASSWORD }],
      ['a non-string password', { email: email('ada'), password: ['x'] }],
      ['an array', []],
    ])('400 for %s', async (_label, body) => {
      expect((await login(body)).status).toBe(400)
    })

    it('400 for a body that is not JSON', async () => {
      const res = await app.fetch(new Request(url('/auth/login'), { method: 'POST', headers: { ...SAME_SITE }, body: 'nope' }))
      expect(res.status).toBe(400)
    })
  })

  // ─── throttling ────────────────────────────────────────────────────────────

  describe('login throttling', () => {
    it('locks an account after repeated failures, even for the right password, and says when to retry', async () => {
      for (let i = 0; i < 3; i++) expect((await login({ email: email('ada'), password: 'wrong password!!' })).status).toBe(401)

      const res = await login({ email: email('ada'), password: PASSWORD })

      expect(res.status).toBe(429)
      expect(await res.json()).toMatchObject({ error: 'TOO_MANY_ATTEMPTS' })
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
      expect(Number(res.headers.get('retry-after'))).toBeLessThanOrEqual(600)
      expect(res.headers.get('set-cookie')).toBeNull()
    })

    it('lets the account sign in again once the lock has passed', async () => {
      for (let i = 0; i < 3; i++) await login({ email: email('ada'), password: 'wrong password!!' })
      expect((await login({ email: email('ada'), password: PASSWORD })).status).toBe(429)

      now += 10 * MINUTE

      expect((await login({ email: email('ada'), password: PASSWORD })).status).toBe(200)
    })

    it('throttles an unknown email exactly like a real one, so locking does not reveal accounts', async () => {
      for (let i = 0; i < 3; i++) await login({ email: email('ghost'), password: 'whatever it is' })

      const res = await login({ email: email('ghost'), password: PASSWORD })

      expect(res.status).toBe(429)
    })

    it('a success clears the failures of that account', async () => {
      await login({ email: email('ada'), password: 'wrong password!!' })
      await login({ email: email('ada'), password: 'wrong password!!' })
      expect((await login({ email: email('ada'), password: PASSWORD })).status).toBe(200)

      await login({ email: email('ada'), password: 'wrong password!!' })
      await login({ email: email('ada'), password: 'wrong password!!' })

      expect((await login({ email: email('ada'), password: PASSWORD })).status).toBe(200)
    })

    it('a stranger guessing at an account only locks themselves out, not the real user on another address', async () => {
      const loginFrom = appBehindProxy()
      for (let i = 0; i < 3; i++) expect((await loginFrom('198.51.100.66', { email: email('ada'), password: 'wrong password!!' })).status).toBe(401)

      expect((await loginFrom('198.51.100.66', { email: email('ada'), password: PASSWORD })).status).toBe(429) // the guesser
      expect((await loginFrom('203.0.113.5', { email: email('ada'), password: PASSWORD })).status).toBe(200) // the owner
    })

    it('guessing spread over many addresses still locks the account for everyone', async () => {
      const loginFrom = appBehindProxy()
      for (let i = 0; i < 8; i++) await loginFrom(`198.51.100.${i + 1}`, { email: email('ada'), password: 'wrong password!!' })

      const owner = await loginFrom('203.0.113.5', { email: email('ada'), password: PASSWORD })

      expect(owner.status).toBe(429)
      expect(await owner.json()).toMatchObject({ error: 'TOO_MANY_ATTEMPTS' })
    })

    it('a success from an address clears that address\'s failures for the account, not the account-wide count', async () => {
      const loginFrom = appBehindProxy()
      await loginFrom('203.0.113.5', { email: email('ada'), password: 'wrong password!!' })
      await loginFrom('203.0.113.5', { email: email('ada'), password: 'wrong password!!' })
      expect((await loginFrom('203.0.113.5', { email: email('ada'), password: PASSWORD })).status).toBe(200)

      // two more failures from the same address start from zero (limit 3), so it is not locked yet
      await loginFrom('203.0.113.5', { email: email('ada'), password: 'wrong password!!' })
      await loginFrom('203.0.113.5', { email: email('ada'), password: 'wrong password!!' })
      expect((await loginFrom('203.0.113.5', { email: email('ada'), password: PASSWORD })).status).toBe(200)
    })

    it('locks an IP address that fails against many accounts', async () => {
      const loginFrom = appBehindProxy(1, 10)
      for (let i = 0; i < 10; i++) await loginFrom('198.51.100.66', { email: email(`victim${i}`), password: 'guess number one' })

      expect((await loginFrom('198.51.100.66', { email: email('ada'), password: PASSWORD })).status).toBe(429)
      expect((await loginFrom('203.0.113.5', { email: email('ada'), password: PASSWORD })).status).toBe(200) // other addresses unaffected
    })

    it('does not put every client with an unknown address into one shared bucket', async () => {
      // No connection info (and no trusted proxy header): attempts against many accounts must not
      // add up on a shared "unknown" address and lock everybody out.
      for (let i = 0; i < 15; i++) await login({ email: email(`stranger${i}`), password: 'guess number one' })

      expect((await login({ email: email('ada'), password: PASSWORD })).status).toBe(200)
    })

    it('lets only as many parallel guesses through as the limit allows, not the whole burst', async () => {
      const loginFrom = appBehindProxy()

      const answers = await Promise.all(
        Array.from({ length: 12 }, () => loginFrom('198.51.100.66', { email: email('ada'), password: 'wrong password!!' })),
      )

      const statuses = answers.map((r) => r.status)
      expect(statuses.filter((s) => s === 401)).toHaveLength(3) // the pair limit
      expect(statuses.filter((s) => s === 429)).toHaveLength(9)
    })

    it('a parallel burst against many accounts from one address is capped by the address limit too', async () => {
      const loginFrom = appBehindProxy(1, 5)

      const answers = await Promise.all(
        Array.from({ length: 12 }, (_, i) => loginFrom('198.51.100.66', { email: email(`burst${i}`), password: 'wrong password!!' })),
      )

      expect(answers.filter((r) => r.status === 401)).toHaveLength(5)
    })

    it('a request that is let in but ends in success does not count against the account or address', async () => {
      const loginFrom = appBehindProxy(1, 3)
      for (let i = 0; i < 6; i++) expect((await loginFrom('203.0.113.5', { email: email('ada'), password: PASSWORD })).status).toBe(200)
    })

    it('does not count a failure of the server itself (the database being down) against the account', async () => {
      const broken = new Hono()
      broken.route(
        '/auth',
        createAuthRouter({
          users: { findCredentialsByEmail: async () => { throw new Error('database down') } } as unknown as UserStore,
          sessions, hasher,
          accountIpThrottle: new LoginThrottle({ maxFailures: 2, windowMs: MINUTE, lockMs: MINUTE }),
          accountThrottle: new LoginThrottle({ maxFailures: 2, windowMs: MINUTE, lockMs: MINUTE }),
          ipThrottle: new LoginThrottle({ maxFailures: 2, windowMs: MINUTE, lockMs: MINUTE }),
          sessionMaxAgeSeconds: 3600,
          trustedProxies: 0,
        }),
      )
      const attempt = () => broken.fetch(new Request(url('/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...SAME_SITE },
        body: JSON.stringify({ email: email('ada'), password: PASSWORD }),
      }))

      const statuses: number[] = []
      for (let i = 0; i < 5; i++) statuses.push((await attempt()).status)

      expect(statuses).toEqual([500, 500, 500, 500, 500]) // never 429: errors are not guesses
    })
  })

  // ─── CSRF ──────────────────────────────────────────────────────────────────

  describe('CSRF protection', () => {
    it('rejects a login without the custom header', async () => {
      const res = await login({ email: email('ada'), password: PASSWORD }, { Origin: 'http://localhost' })
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ error: 'CSRF' })
    })

    it('rejects a request from another origin, even with the header', async () => {
      const res = await login({ email: email('ada'), password: PASSWORD }, { 'X-Nexus-Console': '1', Origin: 'https://evil.example.com' })
      expect(res.status).toBe(403)
    })

    it('rejects the opaque origin "null" (sandboxed iframes, some redirects)', async () => {
      const res = await login({ email: email('ada'), password: PASSWORD }, { 'X-Nexus-Console': '1', Origin: 'null' })
      expect(res.status).toBe(403)
    })

    it('accepts a request with the header and no Origin (non-browser clients)', async () => {
      const res = await login({ email: email('ada'), password: PASSWORD }, { 'X-Nexus-Console': '1' })
      expect(res.status).toBe(200)
    })

    it('logout with only the cookie (a forged cross-site form post) does nothing', async () => {
      const token = await signIn()

      const res = await send('/auth/logout', { method: 'POST', headers: withCookie(token) })

      expect(res.status).toBe(403)
      expect(await sessions.resolve(token)).not.toBeNull()
    })

    it('does not apply to reading the current user', async () => {
      const token = await signIn()
      expect((await send('/auth/me', { headers: withCookie(token) })).status).toBe(200)
    })
  })

  // ─── me & logout ───────────────────────────────────────────────────────────

  describe('GET /auth/me', () => {
    it('401 without a session', async () => {
      const res = await send('/auth/me')
      expect(res.status).toBe(401)
      expect(await res.json()).toMatchObject({ error: 'UNAUTHENTICATED' })
    })

    it('401 for an unknown token', async () => {
      expect((await send('/auth/me', { headers: withCookie('x'.repeat(43)) })).status).toBe(401)
    })

    it('returns the signed-in user and their memberships', async () => {
      const token = await signIn()

      const res = await send('/auth/me', { headers: withCookie(token) })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.user.email).toBe(email('ada'))
      expect(body.memberships).toHaveLength(1)
      expect(JSON.stringify(body)).not.toMatch(/scrypt|passwordHash/i)
    })

    it('401 after the session expired (idle) or the user was disabled', async () => {
      const token = await signIn()
      await sql`UPDATE public.sessions SET last_seen_at = now() - interval '31 minutes' WHERE user_id = ${ada.id}`
      expect((await send('/auth/me', { headers: withCookie(token) })).status).toBe(401)

      const hal = await users.createUser({ email: email('hal'), name: 'Hal', passwordHash: await hasher.hash(PASSWORD) })
      const res = await login({ email: email('hal'), password: PASSWORD })
      const halToken = cookieOf(res).value
      expect((await send('/auth/me', { headers: withCookie(halToken) })).status).toBe(200)
      await users.setStatus(hal.id, 'disabled')
      expect((await send('/auth/me', { headers: withCookie(halToken) })).status).toBe(401)
    })

    it('401 after the password was changed (all sessions end)', async () => {
      const ida = await users.createUser({ email: email('ida'), name: 'Ida', passwordHash: await hasher.hash(PASSWORD) })
      const token = cookieOf(await login({ email: email('ida'), password: PASSWORD })).value

      await users.setPassword(ida.id, await hasher.hash('a brand new passphrase'))

      expect((await send('/auth/me', { headers: withCookie(token) })).status).toBe(401)
    })
  })

  describe('POST /auth/logout', () => {
    it('ends the session and clears the cookie', async () => {
      const token = await signIn()

      const res = await send('/auth/logout', { method: 'POST', headers: { ...SAME_SITE, ...withCookie(token) } })

      expect(res.status).toBe(200)
      expect(cookieOf(res).header).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i)
      expect(await sessions.resolve(token)).toBeNull()
      expect((await send('/auth/me', { headers: withCookie(token) })).status).toBe(401)
    })

    it('is harmless when there is no session', async () => {
      const res = await send('/auth/logout', { method: 'POST', headers: SAME_SITE })
      expect(res.status).toBe(200)
    })
  })
})
