import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from './migrate.js'
import { TenantStore } from './TenantStore.js'
import { EmailTakenError, UserStore } from './UserStore.js'

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'

describe('UserStore (Postgres)', () => {
  const prefix = `us_${crypto.randomUUID().slice(0, 6)}`
  const email = (name: string) => `${prefix}.${name}@example.com`
  let sql: postgres.Sql
  let store: UserStore
  let tenants: TenantStore
  const tenantA = `${prefix}_a`
  const tenantB = `${prefix}_b`

  beforeAll(async () => {
    await runMigrations(DATABASE_URL)
    sql = postgres(DATABASE_URL)
    store = new UserStore(sql)
    tenants = new TenantStore(sql, 'user-store-test-secret')
    await tenants.createTenant(tenantA, 'Tenant A')
    await tenants.createTenant(tenantB, 'Tenant B')
  })

  afterAll(async () => {
    await sql`DELETE FROM public.users WHERE email LIKE ${prefix + '.%'}`
    await sql`DELETE FROM public.tenants WHERE id LIKE ${prefix + '%'}`
    await sql.end()
  })

  describe('createUser', () => {
    it('creates an active user without a password and returns it without any secret', async () => {
      const user = await store.createUser({ email: email('ada'), name: 'Ada Lovelace' })

      expect(user).toMatchObject({ email: email('ada'), name: 'Ada Lovelace', status: 'active', hasPassword: false, lastLoginAt: null })
      expect(user.id).toMatch(/^[0-9a-f]{32}$/)
      expect(user.createdAt).toBeInstanceOf(Date)
      expect(user).not.toHaveProperty('passwordHash')
    })

    it('stores a given password hash and reports hasPassword', async () => {
      const user = await store.createUser({ email: email('hashed'), name: 'Hashed', passwordHash: 'scrypt$1024$8$1$c2FsdA==$aGFzaA==' })
      expect(user.hasPassword).toBe(true)
    })

    it('normalizes the email, so the same address cannot be registered twice with different casing', async () => {
      await store.createUser({ email: email('case'), name: 'Case' })

      await expect(store.createUser({ email: `  ${email('case').toUpperCase()}  `, name: 'Again' })).rejects.toBeInstanceOf(EmailTakenError)
      expect((await store.findByEmail(` ${email('case').toUpperCase()} `))?.email).toBe(email('case'))
    })

    it.each(['not-an-email', '', 'a@b@c.com'])('rejects the invalid email %j', async (bad) => {
      await expect(store.createUser({ email: bad, name: 'X' })).rejects.toThrow(/email/i)
    })

    it('rejects an empty name', async () => {
      await expect(store.createUser({ email: email('noname'), name: '   ' })).rejects.toThrow(/name/i)
    })
  })

  describe('finding users', () => {
    it('finds by id and by email, and returns null when there is none', async () => {
      const created = await store.createUser({ email: email('find'), name: 'Find Me' })

      expect((await store.findById(created.id))?.email).toBe(email('find'))
      expect((await store.findByEmail(email('find')))?.id).toBe(created.id)
      expect(await store.findById('0'.repeat(32))).toBeNull()
      expect(await store.findByEmail(email('nobody'))).toBeNull()
    })

    it('exposes the password hash only through findCredentialsByEmail, for signing in', async () => {
      const hash = 'scrypt$1024$8$1$c2FsdA==$aGFzaA=='
      const created = await store.createUser({ email: email('creds'), name: 'Creds', passwordHash: hash })

      const credentials = await store.findCredentialsByEmail(` ${email('creds').toUpperCase()}`)

      expect(credentials).toMatchObject({ id: created.id, passwordHash: hash, status: 'active' })
      expect(await store.findCredentialsByEmail(email('nobody'))).toBeNull()
      expect(await store.findByEmail(email('creds'))).not.toHaveProperty('passwordHash')
    })

    it('lists users, oldest first, without secrets', async () => {
      const users = (await store.listUsers()).filter((u) => u.email.startsWith(prefix + '.'))

      expect(users.length).toBeGreaterThan(2)
      for (const user of users) expect(user).not.toHaveProperty('passwordHash')
      const times = users.map((u) => u.createdAt.getTime())
      expect(times).toEqual([...times].sort((a, b) => a - b))
    })
  })

  describe('setPassword and setStatus', () => {
    async function withSession(userId: string) {
      await sql`
        INSERT INTO public.sessions (token_hash, user_id, expires_at)
        VALUES (${'tok-' + crypto.randomUUID()}, ${userId}, now() + interval '1 hour')
      `
    }
    const sessionCount = async (userId: string) =>
      (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM public.sessions WHERE user_id = ${userId}`)[0]!.n

    it('sets the password hash and signs the user out everywhere', async () => {
      const user = await store.createUser({ email: email('pw'), name: 'Pw' })
      await withSession(user.id)

      expect(await store.setPassword(user.id, 'scrypt$1024$8$1$c2FsdA==$aGFzaA==')).toBe(true)

      expect((await store.findById(user.id))?.hasPassword).toBe(true)
      expect(await sessionCount(user.id)).toBe(0)
    })

    it('disables a user and signs them out; re-enabling keeps the sessions gone', async () => {
      const user = await store.createUser({ email: email('dis'), name: 'Dis' })
      await withSession(user.id)

      expect(await store.setStatus(user.id, 'disabled')).toBe(true)
      expect((await store.findById(user.id))?.status).toBe('disabled')
      expect(await sessionCount(user.id)).toBe(0)

      expect(await store.setStatus(user.id, 'active')).toBe(true)
      expect((await store.findById(user.id))?.status).toBe('active')
    })

    it('returns false for an unknown user', async () => {
      expect(await store.setPassword('0'.repeat(32), 'x')).toBe(false)
      expect(await store.setStatus('0'.repeat(32), 'disabled')).toBe(false)
    })
  })

  describe('memberships', () => {
    it('grants the operator role (no tenant) and lists it', async () => {
      const user = await store.createUser({ email: email('op'), name: 'Operator' })

      const membership = await store.addMembership(user.id, 'operator', null)

      expect(membership).toMatchObject({ userId: user.id, role: 'operator', tenantId: null })
      expect(await store.listMemberships(user.id)).toEqual([membership])
    })

    it('grants tenant manager of one or several tenants', async () => {
      const user = await store.createUser({ email: email('mgr'), name: 'Manager' })

      await store.addMembership(user.id, 'tenant_manager', tenantA)
      await store.addMembership(user.id, 'tenant_manager', tenantB)
      await store.addMembership(user.id, 'operator', null)

      const memberships = await store.listMemberships(user.id)
      expect(memberships.map((m) => `${m.role}:${m.tenantId}`).sort()).toEqual(
        [`operator:null`, `tenant_manager:${tenantA}`, `tenant_manager:${tenantB}`].sort(),
      )
    })

    it('is idempotent: granting the same role again returns the existing membership', async () => {
      const user = await store.createUser({ email: email('idem'), name: 'Idem' })

      const first = await store.addMembership(user.id, 'tenant_manager', tenantA)
      const second = await store.addMembership(user.id, 'tenant_manager', tenantA)
      const op1 = await store.addMembership(user.id, 'operator', null)
      const op2 = await store.addMembership(user.id, 'operator', null)

      expect(second.id).toBe(first.id)
      expect(op2.id).toBe(op1.id)
      expect(await store.listMemberships(user.id)).toHaveLength(2)
    })

    it('refuses combinations the model does not allow, in the database as well as in the store', async () => {
      const user = await store.createUser({ email: email('bad'), name: 'Bad' })

      await expect(store.addMembership(user.id, 'operator', tenantA)).rejects.toThrow(/operator/i)
      await expect(store.addMembership(user.id, 'tenant_manager', null)).rejects.toThrow(/tenant/i)
      await expect(store.addMembership(user.id, 'tenant_manager', `${prefix}_missing`)).rejects.toThrow(/tenant/i)
      await expect(store.addMembership('0'.repeat(32), 'operator', null)).rejects.toThrow(/user/i)

      // And straight through SQL, bypassing the store
      await expect(
        sql`INSERT INTO public.memberships (id, user_id, role, tenant_id) VALUES ('m1', ${user.id}, 'operator', ${tenantA})`,
      ).rejects.toMatchObject({ code: '23514' })
      await expect(
        sql`INSERT INTO public.memberships (id, user_id, role, tenant_id) VALUES ('m2', ${user.id}, 'tenant_manager', NULL)`,
      ).rejects.toMatchObject({ code: '23514' })
      await expect(
        sql`INSERT INTO public.memberships (id, user_id, role, tenant_id) VALUES ('m3', ${user.id}, 'superuser', NULL)`,
      ).rejects.toMatchObject({ code: '23514' })
    })

    it('removes a membership, only the one asked for, and only for that user', async () => {
      const user = await store.createUser({ email: email('rm'), name: 'Rm' })
      const other = await store.createUser({ email: email('rm2'), name: 'Rm2' })
      const a = await store.addMembership(user.id, 'tenant_manager', tenantA)
      await store.addMembership(user.id, 'tenant_manager', tenantB)

      expect(await store.removeMembership(other.id, a.id)).toBe(false) // someone else's membership
      expect(await store.removeMembership(user.id, a.id)).toBe(true)
      expect(await store.removeMembership(user.id, a.id)).toBe(false)

      expect((await store.listMemberships(user.id)).map((m) => m.tenantId)).toEqual([tenantB])
    })

    it('are removed with their tenant (the user stays), and with their user', async () => {
      const goneTenant = `${prefix}_gone`
      await tenants.createTenant(goneTenant, 'Going away')
      const user = await store.createUser({ email: email('cascade'), name: 'Cascade' })
      await store.addMembership(user.id, 'tenant_manager', goneTenant)
      await store.addMembership(user.id, 'tenant_manager', tenantA)

      await tenants.deleteTenantAndKeys(goneTenant)

      expect((await store.listMemberships(user.id)).map((m) => m.tenantId)).toEqual([tenantA])
      expect(await store.findById(user.id)).not.toBeNull()

      await sql`DELETE FROM public.users WHERE id = ${user.id}`
      const left = await sql`SELECT 1 FROM public.memberships WHERE user_id = ${user.id}`
      expect(left).toHaveLength(0)
    })
  })

  describe('sessions and invites tables', () => {
    it('are removed together with their user, and every foreign key column is indexed', async () => {
      const user = await store.createUser({ email: email('tables'), name: 'Tables' })
      await sql`INSERT INTO public.sessions (token_hash, user_id, expires_at) VALUES (${'t-' + user.id}, ${user.id}, now() + interval '1 hour')`
      await sql`INSERT INTO public.invites (id, user_id, token_hash, expires_at) VALUES (${'i-' + user.id}, ${user.id}, ${'ih-' + user.id}, now() + interval '1 day')`

      await sql`DELETE FROM public.users WHERE id = ${user.id}`

      expect(await sql`SELECT 1 FROM public.sessions WHERE user_id = ${user.id}`).toHaveLength(0)
      expect(await sql`SELECT 1 FROM public.invites WHERE user_id = ${user.id}`).toHaveLength(0)

      // Postgres does not index foreign keys by itself; cascades and joins scan without these
      const unindexed = await sql<{ table_name: string; fk_column: string }[]>`
        SELECT c.conrelid::regclass::text AS table_name, a.attname AS fk_column
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f'
          AND c.conrelid::regclass::text IN ('memberships', 'sessions', 'invites')
          AND NOT EXISTS (
            SELECT 1 FROM pg_index i
            WHERE i.indrelid = c.conrelid AND i.indkey[0] = a.attnum
          )
      `
      expect(unindexed).toEqual([])
    })

    it('invites keep their creator only as a reference: deleting the creator leaves the invite', async () => {
      const creator = await store.createUser({ email: email('creator'), name: 'Creator' })
      const invitee = await store.createUser({ email: email('invitee'), name: 'Invitee' })
      await sql`INSERT INTO public.invites (id, user_id, token_hash, expires_at, created_by)
                VALUES (${'i-' + invitee.id}, ${invitee.id}, ${'ih-' + invitee.id}, now() + interval '1 day', ${creator.id})`

      await sql`DELETE FROM public.users WHERE id = ${creator.id}`

      const [invite] = await sql`SELECT created_by FROM public.invites WHERE id = ${'i-' + invitee.id}`
      expect(invite).toBeDefined()
      expect(invite!['created_by']).toBeNull()
    })
  })
})
