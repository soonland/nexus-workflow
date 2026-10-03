import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from './migrate.js'
import { InviteStore } from './InviteStore.js'
import { UserStore, type User } from './UserStore.js'

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'
const HOUR = 3_600_000

describe('InviteStore (Postgres)', () => {
  const prefix = `iv_${crypto.randomUUID().slice(0, 6)}`
  let sql: postgres.Sql
  let users: UserStore
  let invites: InviteStore
  let inviter: User

  const newUser = (name: string) => users.createUser({ email: `${prefix}.${name}@example.com`, name })
  const HASH = 'scrypt$1024$8$1$c2FsdA==$aGFzaA=='

  beforeAll(async () => {
    await runMigrations(DATABASE_URL)
    sql = postgres(DATABASE_URL)
    users = new UserStore(sql)
    invites = new InviteStore(sql, { hmacSecret: 'invite-test-secret', ttlMs: 48 * HOUR })
    inviter = await newUser('inviter')
  })

  afterAll(async () => {
    await sql`DELETE FROM public.users WHERE email LIKE ${prefix + '.%'}`
    await sql.end()
  })

  describe('create', () => {
    it('returns a one-time token and stores only a hash of it, with the creator and an expiry', async () => {
      const user = await newUser('create')

      const { token, expiresAt } = await invites.create(user.id, inviter.id)

      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
      const [row] = await sql`SELECT * FROM public.invites WHERE user_id = ${user.id}`
      expect(JSON.stringify(row)).not.toContain(token)
      expect(row).toMatchObject({ created_by: inviter.id, used_at: null })
      expect(row!['token_hash']).toMatch(/^[0-9a-f]{64}$/)
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 47 * HOUR)
      expect(expiresAt.getTime()).toBeLessThan(Date.now() + 49 * HOUR)
    })

    it('invalidates the earlier unused invites of the same user when a new one is issued', async () => {
      const user = await newUser('reissue')
      const first = await invites.create(user.id, inviter.id)

      const second = await invites.create(user.id, inviter.id)

      expect(await invites.inspect(first.token)).toBeNull()
      expect(await invites.accept(first.token, HASH)).toBeNull()
      expect(await invites.inspect(second.token)).not.toBeNull()
      expect(await sql`SELECT 1 FROM public.invites WHERE user_id = ${user.id} AND used_at IS NULL`).toHaveLength(1)
    })

    it('does not touch the invites of other users', async () => {
      const a = await newUser('other-a')
      const b = await newUser('other-b')
      const inviteA = await invites.create(a.id, inviter.id)

      await invites.create(b.id, inviter.id)

      expect(await invites.inspect(inviteA.token)).not.toBeNull()
    })

    it('accepts a missing creator (the first operator is created from the command line)', async () => {
      const user = await newUser('nocreator')
      await expect(invites.create(user.id, null)).resolves.toMatchObject({ token: expect.any(String) })
    })
  })

  describe('inspect', () => {
    it('tells the person who the invite is for, and nothing secret', async () => {
      const user = await newUser('inspect')
      const { token } = await invites.create(user.id, inviter.id)

      const info = await invites.inspect(token)

      expect(info).toMatchObject({ email: user.email, name: 'inspect' })
      expect(info).not.toHaveProperty('passwordHash')
    })

    it.each(['', 'short', 'x'.repeat(43), '../../etc/passwd'])('returns null for the unknown or malformed token %j', async (token) => {
      expect(await invites.inspect(token)).toBeNull()
    })

    it('returns null once the invite has expired', async () => {
      const user = await newUser('expired')
      const { token } = await invites.create(user.id, inviter.id)
      await sql`UPDATE public.invites SET expires_at = now() - interval '1 second' WHERE user_id = ${user.id}`

      expect(await invites.inspect(token)).toBeNull()
    })

    it('returns null for a disabled user', async () => {
      const user = await newUser('disabledinvitee')
      const { token } = await invites.create(user.id, inviter.id)
      await users.setStatus(user.id, 'disabled')

      expect(await invites.inspect(token)).toBeNull()
    })
  })

  describe('accept', () => {
    it('sets the password, uses the invite up and ends the user\'s sessions', async () => {
      const user = await newUser('accept')
      await sql`INSERT INTO public.sessions (token_hash, user_id, expires_at) VALUES (${'t-' + user.id}, ${user.id}, now() + interval '1 hour')`
      const { token } = await invites.create(user.id, inviter.id)

      const accepted = await invites.accept(token, HASH)

      expect(accepted).toMatchObject({ id: user.id, hasPassword: true })
      expect((await users.findCredentialsByEmail(user.email))?.passwordHash).toBe(HASH)
      expect(await sql`SELECT 1 FROM public.sessions WHERE user_id = ${user.id}`).toHaveLength(0)
      const [row] = await sql`SELECT used_at FROM public.invites WHERE user_id = ${user.id}`
      expect(row!['used_at']).toBeInstanceOf(Date)
    })

    it('can be used once only', async () => {
      const user = await newUser('once')
      const { token } = await invites.create(user.id, inviter.id)

      expect(await invites.accept(token, HASH)).not.toBeNull()
      expect(await invites.accept(token, 'scrypt$1024$8$1$b3RoZXI=$b3RoZXI=')).toBeNull()
      expect((await users.findCredentialsByEmail(user.email))?.passwordHash).toBe(HASH) // the second try changed nothing
      expect(await invites.inspect(token)).toBeNull()
    })

    it('lets exactly one of several simultaneous attempts through', async () => {
      const user = await newUser('race')
      const { token } = await invites.create(user.id, inviter.id)

      const results = await Promise.all(Array.from({ length: 8 }, () => invites.accept(token, HASH)))

      expect(results.filter((r) => r !== null)).toHaveLength(1)
    })

    it('refuses an expired invite, a disabled user and an unknown token without changing anything', async () => {
      const expired = await newUser('acc-expired')
      const expiredToken = (await invites.create(expired.id, inviter.id)).token
      await sql`UPDATE public.invites SET expires_at = now() - interval '1 second' WHERE user_id = ${expired.id}`
      const disabled = await newUser('acc-disabled')
      const disabledToken = (await invites.create(disabled.id, inviter.id)).token
      await users.setStatus(disabled.id, 'disabled')

      expect(await invites.accept(expiredToken, HASH)).toBeNull()
      expect(await invites.accept(disabledToken, HASH)).toBeNull()
      expect(await invites.accept('x'.repeat(43), HASH)).toBeNull()
      expect((await users.findById(expired.id))?.hasPassword).toBe(false)
      expect((await users.findById(disabled.id))?.hasPassword).toBe(false)
    })

    it('works for a person who already has a password: an operator re-issuing an invite is how a password is reset', async () => {
      const user = await users.createUser({ email: `${prefix}.reset@example.com`, name: 'Reset', passwordHash: 'scrypt$1024$8$1$b2xk$b2xk' })
      const { token } = await invites.create(user.id, inviter.id)

      await invites.accept(token, HASH)

      expect((await users.findCredentialsByEmail(user.email))?.passwordHash).toBe(HASH)
    })
  })
})
