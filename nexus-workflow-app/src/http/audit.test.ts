import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import postgres from 'postgres'
import { LoginThrottle } from '../auth/LoginThrottle.js'
import { PasswordHasher } from '../auth/PasswordHasher.js'
import { UserAdmin } from '../auth/UserAdmin.js'
import { AuditLog } from '../db/AuditLog.js'
import { InviteStore } from '../db/InviteStore.js'
import { runMigrations } from '../db/migrate.js'
import { SessionStore } from '../db/SessionStore.js'
import { TenantStore } from '../db/TenantStore.js'
import { dropTenantSchema } from '../db/tenantProvisioner.js'
import { UserStore } from '../db/UserStore.js'
import { createAuditRouter } from './audit.js'
import { createAuthRouter } from './auth.js'
import { createAuthMiddleware, type AppVariables } from './middleware/auth.js'
import { createOperatorGuard, createPeopleAdminGuard } from './middleware/operator.js'
import { createTenantsRouter } from './tenants.js'
import { createUsersRouter } from './users.js'

// The audit log, end to end: the real routers mounted as in main.ts, real users, sessions, tenants
// and keys in Postgres. Each administrative action must leave exactly one entry with the right actor,
// refused actions none, and no secret may ever reach the log.

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'
const HMAC = 'audit-test-secret'
const ADMIN_KEY = 'audit-test-admin-key'
const PASSWORD = 'correct horse battery staple'
const MINUTE = 60_000

interface Entry {
  action: string
  actor_kind: string
  actor_id: string | null
  actor_label: string | null
  tenant_ids: string[]
  target: string | null
  details: Record<string, unknown>
}

describe('audit log (Postgres, all routers)', () => {
  const prefix = `ad_${crypto.randomUUID().slice(0, 6)}`
  const tenantA = `${prefix}_a`
  const tenantB = `${prefix}_b`
  // people's emails are stored lower-case
  const email = (name: string) => `${prefix}.${name}@example.com`.toLowerCase()
  let sql: postgres.Sql
  let users: UserStore
  let sessions: SessionStore
  let invites: InviteStore
  let tenants: TenantStore
  let app: Hono<{ Variables: AppVariables }>
  const token: Record<string, string> = {}
  const id: Record<string, string> = {}
  let tenantKeyOfA = ''

  beforeAll(async () => {
    await runMigrations(DATABASE_URL)
    sql = postgres(DATABASE_URL)
    const audit = new AuditLog(sql)
    users = new UserStore(sql)
    sessions = new SessionStore(sql, { hmacSecret: HMAC, idleMs: 30 * MINUTE, maxMs: 24 * 60 * MINUTE })
    invites = new InviteStore(sql, { hmacSecret: HMAC, ttlMs: 24 * 60 * MINUTE })
    tenants = new TenantStore(sql, HMAC)
    const hasher = new PasswordHasher({ N: 1024, r: 8, p: 1 })

    const make = async (name: string, roles: Array<['operator', null] | ['tenant_manager', string]>, password?: string) => {
      const user = await users.createUser({ email: email(name), name, ...(password ? { passwordHash: await hasher.hash(password) } : {}) })
      id[name] = user.id
      return { user, roles }
    }
    // tenants A and B exist up front for the people below; the lifecycle tests create their own
    await tenants.createTenant(tenantA, 'Tenant A')
    await tenants.createTenant(tenantB, 'Tenant B')
    tenantKeyOfA = (await tenants.createApiKey(tenantA, 'service')).plaintext
    for (const { user, roles } of [
      await make('operator', [['operator', null]], PASSWORD),
      await make('managerA', [['tenant_manager', tenantA]], PASSWORD),
      await make('managerB', [['tenant_manager', tenantB]]),
      await make('norole', []),
    ]) {
      for (const [role, tenantId] of roles) await users.addMembership(user.id, role, tenantId)
      token[user.name] = (await sessions.create(user.id, {})).token
    }

    const peopleGuard = createPeopleAdminGuard({ adminApiKey: ADMIN_KEY, sessions, users })
    app = new Hono<{ Variables: AppVariables }>()
    app.route(
      '/auth',
      createAuthRouter({
        audit,
        users,
        sessions,
        invites,
        hasher,
        accountIpThrottle: new LoginThrottle({ maxFailures: 3, windowMs: 15 * MINUTE, lockMs: 10 * MINUTE }),
        accountThrottle: new LoginThrottle({ maxFailures: 20, windowMs: 15 * MINUTE, lockMs: 10 * MINUTE }),
        ipThrottle: new LoginThrottle({ maxFailures: 50, windowMs: 15 * MINUTE, lockMs: 10 * MINUTE }),
        sessionMaxAgeSeconds: 3600,
        trustedProxies: 0,
      }),
    )
    app.route('/users', createUsersRouter({ admin: new UserAdmin(users, invites, audit), guard: peopleGuard }))
    app.route('/audit', createAuditRouter({ audit, guard: peopleGuard }))
    app.route('/tenants', createTenantsRouter(sql, HMAC, ADMIN_KEY, { audit, guard: createOperatorGuard({ adminApiKey: ADMIN_KEY, sessions, users }) }))
    app.use('*', createAuthMiddleware(sql, HMAC, { sessions, users }))
  })

  afterAll(async () => {
    const mine = await sql<Array<{ id: string }>>`SELECT id FROM public.tenants WHERE id LIKE ${prefix + '%'}`
    for (const { id: tenantId } of mine) await dropTenantSchema(tenantId, sql)
    await sql`DELETE FROM public.audit_log WHERE actor_label LIKE ${prefix + '%'} OR target LIKE ${prefix + '%'} OR tenant_ids && ${mine.map((t) => t.id)}::text[] OR details::text LIKE ${'%' + prefix + '%'}`
    await sql`DELETE FROM public.users WHERE email LIKE ${prefix + '.%'}`
    await sql`DELETE FROM public.api_keys WHERE tenant_id LIKE ${prefix + '%'}`
    await sql`DELETE FROM public.tenants WHERE id LIKE ${prefix + '%'}`
    await sql.end()
  })

  // ─── helpers ───────────────────────────────────────────────────────────────

  interface Call {
    method?: string
    session?: string
    bearer?: string
    body?: unknown
  }

  async function call(path: string, c: Call = {}) {
    const method = c.method ?? (c.body === undefined ? 'GET' : 'POST')
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Nexus-Console': '1', Origin: 'http://localhost' }
    if (c.session) headers['Cookie'] = `nexus_session=${token[c.session]}`
    if (c.bearer) headers['Authorization'] = `Bearer ${c.bearer}`
    const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers, ...(c.body === undefined ? {} : { body: JSON.stringify(c.body) }) }))
    return { status: res.status, headers: res.headers, body: (await res.json().catch(() => ({}))) as Record<string, any> }
  }

  const ADMIN = { bearer: ADMIN_KEY }

  /** Every entry this run has made so far, oldest first (the table is shared with other test files). */
  async function entries(): Promise<Entry[]> {
    return sql<Entry[]>`
      SELECT action, actor_kind, actor_id, actor_label, tenant_ids, target, details FROM public.audit_log
      WHERE actor_label LIKE ${prefix + '%'} OR target LIKE ${prefix + '%'} OR tenant_ids && ${[tenantA, tenantB, `${prefix}_c`]}::text[]
         OR details::text LIKE ${'%' + prefix + '%'}
         OR target = ANY(${Object.values(id)}::text[])
      ORDER BY at, id`
  }
  const only = async (action: string, where: (e: Entry) => boolean = () => true) => (await entries()).filter((e) => e.action === action && where(e))

  // ─── tenants and keys ──────────────────────────────────────────────────────

  describe('tenants and keys', () => {
    const tenantC = `${prefix}_c`
    let keyId = ''
    let plaintext = ''

    it('creating a tenant makes one entry naming the admin key as the actor', async () => {
      expect((await call('/tenants', { ...ADMIN, body: { id: tenantC, name: 'Tenant C' } })).status).toBe(201)

      const found = await only('tenant.create', (e) => e.target === tenantC)
      expect(found).toHaveLength(1)
      expect(found[0]).toMatchObject({ actor_kind: 'adminKey', actor_id: null, actor_label: 'admin key', tenant_ids: [tenantC], details: { name: 'Tenant C' } })
    })

    it('a refused request makes no entry', async () => {
      expect((await call('/tenants', { ...ADMIN, body: { id: tenantC, name: 'Again' } })).status).toBe(409) // already exists
      expect((await call('/tenants', { session: 'managerA', body: { id: `${prefix}_d`, name: 'D' } })).status).toBe(403)

      expect(await only('tenant.create', (e) => e.target === tenantC)).toHaveLength(1)
      expect(await only('tenant.create', (e) => e.target === `${prefix}_d`)).toHaveLength(0)
    })

    it('suspend, reactivate and rename each make one entry, with the signed-in operator as the actor', async () => {
      await call(`/tenants/${tenantC}`, { session: 'operator', method: 'PATCH', body: { status: 'suspended' } })
      await call(`/tenants/${tenantC}`, { session: 'operator', method: 'PATCH', body: { status: 'active' } })
      await call(`/tenants/${tenantC}`, { session: 'operator', method: 'PATCH', body: { name: 'Renamed C' } })

      for (const action of ['tenant.suspend', 'tenant.reactivate', 'tenant.rename']) {
        const found = await only(action, (e) => e.target === tenantC)
        expect({ action, count: found.length }).toEqual({ action, count: 1 })
        expect(found[0]).toMatchObject({ actor_kind: 'user', actor_id: id['operator'], actor_label: email('operator'), tenant_ids: [tenantC] })
      }
      expect((await only('tenant.rename', (e) => e.target === tenantC))[0]?.details).toEqual({ name: 'Renamed C' })
    })

    it('creating a key records its name and id, never the key itself', async () => {
      const created = await call(`/tenants/${tenantC}/keys`, { session: 'operator', body: { name: 'ci pipeline' } })
      expect(created.status).toBe(201)
      keyId = created.body['key'].id
      plaintext = created.body['plaintext']

      const found = await only('key.create', (e) => e.target === keyId)
      expect(found).toHaveLength(1)
      expect(found[0]).toMatchObject({ actor_kind: 'user', tenant_ids: [tenantC], details: { name: 'ci pipeline' } })
      expect(JSON.stringify(await entries())).not.toContain(plaintext)
    })

    it('revoking a key makes one entry', async () => {
      expect((await call(`/tenants/${tenantC}/keys/${keyId}`, { ...ADMIN, method: 'DELETE' })).status).toBe(200)
      expect((await call(`/tenants/${tenantC}/keys/${keyId}`, { ...ADMIN, method: 'DELETE' })).status).toBe(404) // already revoked: nothing happened

      const found = await only('key.revoke', (e) => e.target === keyId)
      expect(found).toHaveLength(1)
      expect(found[0]).toMatchObject({ actor_kind: 'adminKey', tenant_ids: [tenantC] })
    })

    it('deleting a tenant makes one entry, and the entry outlives the tenant', async () => {
      expect((await call(`/tenants/${tenantC}`, { ...ADMIN, method: 'DELETE' })).status).toBe(200)

      const found = await only('tenant.delete', (e) => e.target === tenantC)
      expect(found).toHaveLength(1)
      expect(found[0]).toMatchObject({ actor_kind: 'adminKey', tenant_ids: [tenantC] })
      expect(await tenants.getTenant(tenantC)).toBeNull()
      expect(await only('tenant.create', (e) => e.target === tenantC)).toHaveLength(1) // the history is still there
    })
  })

  // ─── people ────────────────────────────────────────────────────────────────

  describe('people', () => {
    let personId = ''
    const person = () => email('person')

    it('creating a person makes one entry (not one per role), filed under the tenants they manage', async () => {
      const created = await call('/users', {
        session: 'operator',
        body: { email: person(), name: 'Person', memberships: [{ role: 'tenant_manager', tenantId: tenantA }, { role: 'tenant_manager', tenantId: tenantB }] },
      })
      expect(created.status).toBe(201)
      personId = created.body['user'].id
      id['person'] = personId

      const found = await only('user.create', (e) => e.target === personId)
      expect(found).toHaveLength(1)
      expect(found[0]).toMatchObject({ actor_kind: 'user', actor_id: id['operator'], tenant_ids: [tenantA, tenantB], details: { email: person() } })
      expect(await only('membership.add', (e) => e.target === personId)).toHaveLength(0)
    })

    it('the invite link never reaches the log', async () => {
      const created = await call('/users', { session: 'operator', body: { email: email('linked'), name: 'Linked', memberships: [{ role: 'tenant_manager', tenantId: tenantA }] } })
      const inviteToken: string = created.body['invite'].token

      expect(JSON.stringify(await entries())).not.toContain(inviteToken)
    })

    it('disabling and enabling make one entry each', async () => {
      await call(`/users/${personId}`, { session: 'operator', method: 'PATCH', body: { status: 'disabled' } })
      await call(`/users/${personId}`, { session: 'operator', method: 'PATCH', body: { status: 'active' } })

      expect(await only('user.disable', (e) => e.target === personId)).toHaveLength(1)
      expect(await only('user.enable', (e) => e.target === personId)).toHaveLength(1)
    })

    it('adding and removing a role make one entry each, filed under that role\'s tenant', async () => {
      const added = await call(`/users/${personId}/memberships`, { session: 'operator', body: { role: 'operator' } })
      expect(added.status).toBe(201)
      const membershipId: string = added.body['membership'].id

      await call(`/users/${personId}/memberships/${membershipId}`, { session: 'operator', method: 'DELETE' })

      const add = await only('membership.add', (e) => e.target === personId)
      const remove = await only('membership.remove', (e) => e.target === personId)
      expect(add).toHaveLength(1)
      expect(remove).toHaveLength(1)
      expect(add[0]).toMatchObject({ tenant_ids: [], details: { role: 'operator', tenantId: null } }) // platform-wide: operators only
      expect(remove[0]?.details).toMatchObject({ role: 'operator' })
    })

    it('inviting again makes one entry, and says whether it is a password reset', async () => {
      await call(`/users/${personId}/invite`, { session: 'operator', method: 'POST', body: {} })

      const found = await only('invite.create', (e) => e.target === personId)
      expect(found).toHaveLength(1)
      expect(found[0]?.details).toMatchObject({ email: person(), reset: false })
    })

    it('a tenant manager\'s changes are recorded with the manager as the actor', async () => {
      const created = await call('/users', { session: 'managerA', body: { email: email('byManager'), name: 'By Manager', memberships: [{ role: 'tenant_manager', tenantId: tenantA }] } })
      expect(created.status).toBe(201)

      const found = await only('user.create', (e) => e.target === created.body['user'].id)
      expect(found[0]).toMatchObject({ actor_kind: 'user', actor_id: id['managerA'], actor_label: email('managerA'), tenant_ids: [tenantA] })
    })

    it('refused changes make no entry', async () => {
      const before = (await entries()).length
      expect((await call('/users', { session: 'managerA', body: { email: email('sneaky'), name: 'Sneaky', memberships: [{ role: 'operator', tenantId: null }] } })).status).toBe(403)
      expect((await call(`/users/${id['operator']}`, { session: 'operator', method: 'PATCH', body: { status: 'disabled' } })).status).toBe(409) // not yourself
      expect((await call(`/users/${id['operator']}/memberships`, { session: 'managerA', body: { role: 'operator' } })).status).toBe(404) // out of scope

      expect((await entries()).length).toBe(before)
    })
  })

  // ─── signing in ────────────────────────────────────────────────────────────

  describe('signing in', () => {
    it('a successful sign-in makes one entry, with the address and without the password', async () => {
      const res = await call('/auth/login', { body: { email: email('operator'), password: PASSWORD } })
      expect(res.status).toBe(200)

      const found = await only('login.success', (e) => e.actor_id === id['operator'])
      expect(found).toHaveLength(1)
      expect(found[0]).toMatchObject({ actor_kind: 'user', actor_label: email('operator'), tenant_ids: [] })
      expect(found[0]?.details).toHaveProperty('ip')
      expect(JSON.stringify(await entries())).not.toContain(PASSWORD)
    })

    it('a failed sign-in makes one entry that says why, while the caller is told nothing', async () => {
      const wrong = await call('/auth/login', { body: { email: email('managerA'), password: 'not the password at all' } })
      const unknown = await call('/auth/login', { body: { email: email('nobody'), password: 'not the password at all' } })
      expect(wrong.body).toEqual(unknown.body) // no hint to the caller

      const failures = await only('login.failure')
      const forManager = failures.filter((e) => e.actor_label === email('managerA'))
      const forNobody = failures.filter((e) => e.actor_label === email('nobody'))
      expect(forManager).toHaveLength(1)
      expect(forNobody).toHaveLength(1)
      expect(forManager[0]).toMatchObject({ actor_kind: 'anonymous', actor_id: null, details: { reason: 'bad credentials' } })
      expect(JSON.stringify(failures)).not.toContain('not the password at all')
    })

    it('a disabled account\'s failed sign-in is recorded as such', async () => {
      const disabled = await users.createUser({ email: email('disabled'), name: 'Disabled', passwordHash: await new PasswordHasher({ N: 1024, r: 8, p: 1 }).hash(PASSWORD) })
      await users.setStatus(disabled.id, 'disabled')

      expect((await call('/auth/login', { body: { email: email('disabled'), password: PASSWORD } })).status).toBe(401)

      const found = (await only('login.failure')).filter((e) => e.actor_label === email('disabled'))
      expect(found).toHaveLength(1)
      expect(found[0]?.details).toMatchObject({ reason: 'account disabled' })
    })

    it('attempts the throttle refuses are not logged, so guessing cannot flood the log', async () => {
      for (let i = 0; i < 6; i++) await call('/auth/login', { body: { email: email('flooded'), password: `guess ${i}` } })

      const logged = (await only('login.failure')).filter((e) => e.actor_label === email('flooded'))
      expect(logged.length).toBeLessThanOrEqual(3) // the throttle allows 3 per account and address
      expect(logged.length).toBeGreaterThan(0)
    })

    it('accepting an invite makes one entry', async () => {
      const created = await call('/users', { session: 'operator', body: { email: email('joiner'), name: 'Joiner', memberships: [{ role: 'tenant_manager', tenantId: tenantA }] } })
      const inviteToken: string = created.body['invite'].token
      id['joiner'] = created.body['user'].id

      const accepted = await call('/auth/accept-invite', { body: { token: inviteToken, password: PASSWORD } })
      expect(accepted.status).toBe(200)

      const found = await only('invite.accept', (e) => e.actor_id === id['joiner'])
      expect(found).toHaveLength(1)
      expect(found[0]).toMatchObject({ actor_kind: 'user', tenant_ids: [tenantA] })
      expect(JSON.stringify(await entries())).not.toContain(inviteToken)
    })
  })

  // ─── reading it ────────────────────────────────────────────────────────────

  describe('GET /audit', () => {
    beforeAll(async () => {
      // known entries for tenant A only, B only, both, and none
      const audit = new AuditLog(sql)
      const by = { kind: 'user' as const, id: 'reader-test', label: `${prefix}.reader@example.com` }
      await audit.record({ action: `${prefix}.only-a`, actor: by, tenantIds: [tenantA], target: `${prefix}-t1` })
      await audit.record({ action: `${prefix}.only-b`, actor: by, tenantIds: [tenantB], target: `${prefix}-t2` })
      await audit.record({ action: `${prefix}.both`, actor: by, tenantIds: [tenantA, tenantB], target: `${prefix}-t3` })
      await audit.record({ action: `${prefix}.platform`, actor: by, tenantIds: [], target: `${prefix}-t4` })
    })

    const actionsOf = (body: Record<string, any>) => (body['entries'] as Array<{ action: string }>).map((e) => e.action).filter((a) => a.startsWith(prefix))

    it('401 without a credential, 403 for a tenant API key and for people with no admin role', async () => {
      expect((await call('/audit')).status).toBe(401)
      expect((await call('/audit', { bearer: tenantKeyOfA })).status).toBe(403)
      expect((await call('/audit', { session: 'norole' })).status).toBe(403)
    })

    it('an operator reads everything, and so does the admin key', async () => {
      for (const who of [{ session: 'operator' }, ADMIN]) {
        const res = await call(`/audit?action=${prefix}&pageSize=100`, who)
        expect(res.status).toBe(200)
        expect(actionsOf(res.body).sort()).toEqual([`${prefix}.both`, `${prefix}.only-a`, `${prefix}.only-b`, `${prefix}.platform`])
      }
    })

    it('a tenant manager reads only entries that name tenants, all of them theirs', async () => {
      const a = await call(`/audit?action=${prefix}&pageSize=100`, { session: 'managerA' })
      const b = await call(`/audit?action=${prefix}&pageSize=100`, { session: 'managerB' })

      expect(actionsOf(a.body)).toEqual([`${prefix}.only-a`]) // not B's, not the one shared with B, not the platform-wide one
      expect(actionsOf(b.body)).toEqual([`${prefix}.only-b`])
      expect(a.body['total']).toBe(1)
    })

    it('a tenant manager asking for another tenant is refused', async () => {
      expect((await call(`/audit?tenant=${tenantB}`, { session: 'managerA' })).status).toBe(403)
      expect((await call(`/audit?tenant=${tenantA}`, { session: 'managerA' })).status).toBe(200)
    })

    it('a manager sees what happened to their own tenants, but never another tenant\'s details', async () => {
      const res = await call(`/audit?pageSize=100`, { session: 'managerA' })
      const text = JSON.stringify(res.body)

      expect(text).not.toContain(`${prefix}.only-b`)
      expect(text).not.toContain(`"${tenantB}"`) // no entry shown to A's manager even mentions B
      expect(text).not.toContain('login.success') // sign-ins are platform-wide
    })

    it('filters by tenant, actor, action family and time, and pages', async () => {
      const byTenant = await call(`/audit?tenant=${tenantB}&action=${prefix}&pageSize=100`, { session: 'operator' })
      expect(actionsOf(byTenant.body).sort()).toEqual([`${prefix}.both`, `${prefix}.only-b`])

      const byActor = await call(`/audit?actor=${id['operator']}&action=user&pageSize=100`, { session: 'operator' })
      expect(byActor.body['entries'].every((e: { actor: { id: string }; action: string }) => e.actor.id === id['operator'] && e.action.startsWith('user.'))).toBe(true)

      const future = await call(`/audit?from=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`, { session: 'operator' })
      expect(future.body['entries']).toEqual([])

      const paged = await call(`/audit?pageSize=2&page=1`, { session: 'operator' })
      expect(paged.body['entries']).toHaveLength(2)
      expect(paged.body).toMatchObject({ page: 1, pageSize: 2 })
    })

    it('rejects nonsense in the query with a clear 400', async () => {
      for (const query of ['page=-1', 'page=abc', 'pageSize=0', 'pageSize=101', 'from=yesterday', 'to=never']) {
        const res = await call(`/audit?${query}`, { session: 'operator' })
        expect({ query, status: res.status }).toEqual({ query, status: 400 })
        expect(res.body['error']).toBe('VALIDATION_ERROR')
      }
    })

    it('is not cached', async () => {
      expect((await call('/audit', { session: 'operator' })).headers.get('Cache-Control')).toBe('no-store')
    })

    it('shows entries newest first, with the actor spelled out', async () => {
      const res = await call(`/audit?pageSize=100`, { session: 'operator' })
      const times: string[] = res.body['entries'].map((e: { at: string }) => e.at)

      expect([...times].sort().reverse()).toEqual(times)
      expect(res.body['entries'][0]).toMatchObject({ actor: { kind: expect.any(String) }, action: expect.any(String), tenantIds: expect.any(Array) })
    })
  })
})
