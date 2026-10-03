import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from './migrate.js'
import { SessionStore } from './SessionStore.js'
import { UserStore, type User } from './UserStore.js'

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'
const MINUTE = 60_000
const IDLE_MS = 30 * MINUTE
const MAX_MS = 24 * 60 * MINUTE

describe('SessionStore (Postgres)', () => {
  const prefix = `ss_${crypto.randomUUID().slice(0, 6)}`
  let sql: postgres.Sql
  let users: UserStore
  let sessions: SessionStore
  let user: User

  const hashOf = async (userId: string) =>
    (await sql<{ token_hash: string }[]>`SELECT token_hash FROM public.sessions WHERE user_id = ${userId}`).map((r) => r.token_hash)

  beforeAll(async () => {
    await runMigrations(DATABASE_URL)
    sql = postgres(DATABASE_URL)
    users = new UserStore(sql)
    sessions = new SessionStore(sql, { hmacSecret: 'session-test-secret', idleMs: IDLE_MS, maxMs: MAX_MS })
  })

  afterAll(async () => {
    await sql`DELETE FROM public.users WHERE email LIKE ${prefix + '.%'}`
    await sql.end()
  })

  async function newUser(name: string): Promise<User> {
    return users.createUser({ email: `${prefix}.${name}@example.com`, name })
  }

  describe('create', () => {
    it('returns a random token and stores only a hash of it', async () => {
      user = await newUser('create')

      const { token, expiresAt } = await sessions.create(user.id, { userAgent: 'vitest', ip: '203.0.113.7' })

      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
      const [row] = await sql`SELECT * FROM public.sessions WHERE user_id = ${user.id}`
      expect(row).toBeDefined()
      expect(JSON.stringify(row)).not.toContain(token)
      expect(row!['token_hash']).toMatch(/^[0-9a-f]{64}$/)
      expect(row).toMatchObject({ user_agent: 'vitest', ip: '203.0.113.7' })
      // the absolute lifetime is applied to the stored expiry
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + MAX_MS - MINUTE)
      expect(expiresAt.getTime()).toBeLessThan(Date.now() + MAX_MS + MINUTE)
    })

    it('gives every session a different token', async () => {
      const u = await newUser('unique')
      const [a, b] = await Promise.all([sessions.create(u.id, {}), sessions.create(u.id, {})])
      expect(a.token).not.toBe(b.token)
      expect(new Set(await hashOf(u.id)).size).toBe(2)
    })

    it('truncates an oversized user agent instead of storing it whole', async () => {
      const u = await newUser('ua')
      await sessions.create(u.id, { userAgent: 'x'.repeat(5000) })
      const [row] = await sql<{ ua: string }[]>`SELECT user_agent AS ua FROM public.sessions WHERE user_id = ${u.id}`
      expect(row!.ua.length).toBeLessThanOrEqual(512)
    })
  })

  describe('resolve', () => {
    it('returns the signed-in user for a valid token, without secrets', async () => {
      const u = await newUser('resolve')
      const { token } = await sessions.create(u.id, {})

      const resolved = await sessions.resolve(token)

      expect(resolved?.user).toMatchObject({ id: u.id, email: u.email, status: 'active' })
      expect(resolved?.user).not.toHaveProperty('passwordHash')
    })

    it.each(['', 'short', 'x'.repeat(43), 'a b'.repeat(20), '../../etc/passwd'])('returns null for the unknown or malformed token %j', async (token) => {
      expect(await sessions.resolve(token)).toBeNull()
    })

    it('returns null once the session has been idle for too long', async () => {
      const u = await newUser('idle')
      const { token } = await sessions.create(u.id, {})
      await sql`UPDATE public.sessions SET last_seen_at = now() - interval '31 minutes' WHERE user_id = ${u.id}`

      expect(await sessions.resolve(token)).toBeNull()
    })

    it('returns null once the absolute lifetime is over, however recently it was used', async () => {
      const u = await newUser('absolute')
      const { token } = await sessions.create(u.id, {})
      await sql`UPDATE public.sessions SET expires_at = now() - interval '1 second' WHERE user_id = ${u.id}`

      expect(await sessions.resolve(token)).toBeNull()
    })

    it('slides the idle window: using a session keeps it alive, but not past the absolute limit', async () => {
      const u = await newUser('slide')
      const { token } = await sessions.create(u.id, {})
      await sql`UPDATE public.sessions SET last_seen_at = now() - interval '20 minutes' WHERE user_id = ${u.id}`

      expect(await sessions.resolve(token)).not.toBeNull()

      const [row] = await sql<{ age: number }[]>`SELECT extract(epoch from now() - last_seen_at)::float AS age FROM public.sessions WHERE user_id = ${u.id}`
      expect(row!.age).toBeLessThan(5) // refreshed
    })

    it('does not write on every request: a recently refreshed session is left alone', async () => {
      const u = await newUser('nowrite')
      const { token } = await sessions.create(u.id, {})
      await sql`UPDATE public.sessions SET last_seen_at = now() - interval '10 seconds' WHERE user_id = ${u.id}`

      await sessions.resolve(token)

      const [row] = await sql<{ age: number }[]>`SELECT extract(epoch from now() - last_seen_at)::float AS age FROM public.sessions WHERE user_id = ${u.id}`
      expect(row!.age).toBeGreaterThan(8)
    })

    it('returns null for a disabled user, even if their session row somehow survived', async () => {
      const u = await newUser('disabled')
      const { token } = await sessions.create(u.id, {})
      await sql`UPDATE public.users SET status = 'disabled' WHERE id = ${u.id}`

      expect(await sessions.resolve(token)).toBeNull()
    })
  })

  describe('destroy', () => {
    it('ends one session and leaves the user their others', async () => {
      const u = await newUser('destroy')
      const a = await sessions.create(u.id, {})
      const b = await sessions.create(u.id, {})

      await sessions.destroy(a.token)

      expect(await sessions.resolve(a.token)).toBeNull()
      expect(await sessions.resolve(b.token)).not.toBeNull()
    })

    it('is quiet about unknown or malformed tokens', async () => {
      await expect(sessions.destroy('nope')).resolves.toBeUndefined()
      await expect(sessions.destroy('x'.repeat(43))).resolves.toBeUndefined()
    })

    it('destroyAllForUser signs the user out everywhere', async () => {
      const u = await newUser('destroyall')
      const a = await sessions.create(u.id, {})
      const b = await sessions.create(u.id, {})

      await sessions.destroyAllForUser(u.id)

      expect(await sessions.resolve(a.token)).toBeNull()
      expect(await sessions.resolve(b.token)).toBeNull()
    })
  })

  describe('purgeExpired', () => {
    it('deletes sessions past their absolute or idle expiry, and only those', async () => {
      const u = await newUser('purge')
      const live = await sessions.create(u.id, {})
      await sessions.create(u.id, {})
      await sessions.create(u.id, {})
      const rows = await sql<{ token_hash: string }[]>`SELECT token_hash FROM public.sessions WHERE user_id = ${u.id} ORDER BY created_at, token_hash`
      const [, expired, idle] = rows
      await sql`UPDATE public.sessions SET expires_at = now() - interval '1 minute' WHERE token_hash = ${expired!.token_hash}`
      await sql`UPDATE public.sessions SET last_seen_at = now() - interval '2 hours' WHERE token_hash = ${idle!.token_hash}`

      const removed = await sessions.purgeExpired()

      expect(removed).toBeGreaterThanOrEqual(2)
      const left = await sql`SELECT token_hash FROM public.sessions WHERE user_id = ${u.id}`
      expect(left.map((r) => r['token_hash'])).not.toContain(expired!.token_hash)
      expect(left.map((r) => r['token_hash'])).not.toContain(idle!.token_hash)
      expect(await sessions.resolve(live.token)).not.toBeNull()
    })
  })
})
