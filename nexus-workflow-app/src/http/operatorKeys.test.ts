import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Hono } from 'hono'
import postgres from 'postgres'
import { UserAdmin } from '../auth/UserAdmin.js'
import { AuditLog } from '../db/AuditLog.js'
import { InviteStore } from '../db/InviteStore.js'
import { runMigrations } from '../db/migrate.js'
import { OperatorKeyStore } from '../db/OperatorKeyStore.js'
import { SessionStore } from '../db/SessionStore.js'
import { TenantStore } from '../db/TenantStore.js'
import { dropTenantSchema } from '../db/tenantProvisioner.js'
import { UserStore } from '../db/UserStore.js'
import { createAuthMiddleware, type AppVariables } from './middleware/auth.js'
import { createOperatorGuard, createOperatorKeyAdminGuard, createPeopleAdminGuard } from './middleware/operator.js'
import { createOperatorKeysRouter } from './operatorKeys.js'
import { createTenantsRouter } from './tenants.js'
import { createUsersRouter } from './users.js'

// Operator keys through the real guards, router and stores in Postgres.

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'
const HMAC = 'operator-keys-http-secret'
const ADMIN_KEY = 'operator-keys-admin-key'
const MINUTE = 60_000

describe('operator keys (Postgres, real guards)', () => {
  const prefix = `ok_${crypto.randomUUID().slice(0, 6)}`
  const tenant = `${prefix}_t`
  let sql: postgres.Sql
  let app: Hono<{ Variables: AppVariables }>
  let store: OperatorKeyStore
  let audit: AuditLog
  let sessions: SessionStore
  let users: UserStore
  const token: Record<string, string> = {}
  const id: Record<string, string> = {}
  let tenantKey = ''
  let recorded: Array<Record<string, any>>

  beforeAll(async () => {
    await runMigrations(DATABASE_URL)
    sql = postgres(DATABASE_URL)
    store = new OperatorKeyStore(sql, HMAC)
    users = new UserStore(sql)
    sessions = new SessionStore(sql, { hmacSecret: HMAC, idleMs: 30 * MINUTE, maxMs: 24 * 60 * MINUTE })
    const tenants = new TenantStore(sql, HMAC)
    await tenants.createTenant(tenant, 'Tenant')
    tenantKey = (await tenants.createApiKey(tenant, 'worker', { role: 'tenant_manager' })).plaintext

    for (const [name, role] of [['operator', 'operator'], ['manager', 'tenant_manager']] as const) {
      const user = await users.createUser({ email: `${prefix}.${name}@example.com`, name })
      id[name] = user.id
      await users.addMembership(user.id, role, role === 'operator' ? null : tenant)
      token[name] = (await sessions.create(user.id, {})).token
    }

    // capture what is written to the audit log, and also write it for real
    recorded = []
    audit = new AuditLog(sql)
    const realRecord = audit.record.bind(audit)
    vi.spyOn(audit, 'record').mockImplementation(async (entry) => {
      recorded.push(entry as unknown as Record<string, any>)
      await realRecord(entry)
    })
    const realStrict = audit.recordStrict.bind(audit)
    vi.spyOn(audit, 'recordStrict').mockImplementation(async (entry, tx) => {
      recorded.push(entry as unknown as Record<string, any>)
      await realStrict(entry, tx)
    })

    const deps = { adminApiKey: ADMIN_KEY, sessions, users, operatorKeys: store }
    app = new Hono<{ Variables: AppVariables }>()
    app.route('/operator-keys', createOperatorKeysRouter({ keys: store, audit, guard: createOperatorKeyAdminGuard(deps) }))
    app.route('/tenants', createTenantsRouter(sql, HMAC, ADMIN_KEY, { guard: createOperatorGuard(deps), audit }))
    const invites = new InviteStore(sql, { hmacSecret: HMAC, ttlMs: 24 * 60 * MINUTE })
    app.route('/users', createUsersRouter({ admin: new UserAdmin(users, invites, audit), guard: createPeopleAdminGuard(deps) }))
    app.get('/people', createPeopleAdminGuard(deps), (c) => c.json({ principal: c.get('principal')?.kind }))
    app.use('*', createAuthMiddleware(sql, HMAC, { sessions, users }))
    app.get('/definitions', (c) => c.json({ tenantId: c.get('tenantId') }))
  })

  afterAll(async () => {
    // whatever the tests provisioned must not outlive them (the tests run against the development database)
    const left = await sql<Array<{ id: string }>>`SELECT id FROM public.tenants WHERE id LIKE ${prefix + '%'}`
    for (const { id: tenantId } of left) await dropTenantSchema(tenantId, sql)
    await sql`DELETE FROM public.audit_log WHERE details::text LIKE ${'%' + prefix + '%'} OR actor_label LIKE ${prefix + '%'}`
    await sql`DELETE FROM public.operator_keys WHERE name LIKE ${prefix + '%'}`
    await sql`DELETE FROM public.api_keys WHERE tenant_id LIKE ${prefix + '%'}`
    await sql`DELETE FROM public.tenants WHERE id LIKE ${prefix + '%'}`
    await sql`DELETE FROM public.users WHERE email LIKE ${prefix + '.%'}`
    await sql.end()
  })

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

  const create = async (name: string, who: Call = { session: 'operator' }, extra: Record<string, unknown> = {}) => {
    const res = await call('/operator-keys', { ...who, body: { name: `${prefix} ${name}`, ...extra } })
    return { res, key: res.body['key'] as Record<string, any>, plaintext: res.body['plaintext'] as string }
  }

  // ─── managing ──────────────────────────────────────────────────────────────

  describe('managing keys', () => {
    it('a signed-in operator creates one: the secret is in the answer once, and the key records who', async () => {
      const { res, key, plaintext } = await create('made by a person')

      expect(res.status).toBe(201)
      expect(plaintext).toMatch(/^nxop_[0-9a-f]{64}$/)
      expect(key).toMatchObject({ name: `${prefix} made by a person`, createdBy: id['operator'], expiresAt: null, revokedAt: null })
      expect(JSON.stringify(key)).not.toContain(plaintext)
      expect(res.headers.get('Cache-Control')).toBe('no-store')
    })

    it('the admin key creates one too, with nobody recorded', async () => {
      const { res, key } = await create('made by the admin key', { bearer: ADMIN_KEY })

      expect(res.status).toBe(201)
      expect(key['createdBy']).toBeNull()
    })

    it('lists keys without secrets, hashes, or the plaintext of any key', async () => {
      const { plaintext } = await create('listed')

      const list = await call('/operator-keys', { session: 'operator' })

      expect(list.status).toBe(200)
      expect((list.body['keys'] as Array<{ name: string }>).some((k) => k.name === `${prefix} listed`)).toBe(true)
      expect(JSON.stringify(list.body)).not.toMatch(/key_hash|keyHash|nxop_/)
      expect(JSON.stringify(list.body)).not.toContain(plaintext)
    })

    it('refuses a name that is missing or blank, and one that is too long', async () => {
      for (const body of [{}, { name: '' }, { name: '   ' }, { name: 42 }, { name: 'n'.repeat(256) }]) {
        expect((await call('/operator-keys', { session: 'operator', body })).status).toBe(400)
      }
    })

    it('takes an expiry in the future, and refuses a past or invalid one', async () => {
      const future = new Date(Date.now() + 90 * 86_400_000).toISOString()

      const ok = await create('expiring', { session: 'operator' }, { expiresAt: future })
      expect(ok.res.status).toBe(201)
      expect(ok.key['expiresAt']).toBe(future)

      for (const expiresAt of [new Date(Date.now() - 1000).toISOString(), 'next week', 12345]) {
        const res = await call('/operator-keys', { session: 'operator', body: { name: `${prefix} bad`, expiresAt } })
        expect({ expiresAt, status: res.status }).toEqual({ expiresAt, status: 400 })
      }
    })

    it('revokes a key, and a second revoke is a 404', async () => {
      const { key } = await create('to revoke')

      expect((await call(`/operator-keys/${key['id']}`, { session: 'operator', method: 'DELETE' })).status).toBe(200)
      expect((await call(`/operator-keys/${key['id']}`, { session: 'operator', method: 'DELETE' })).status).toBe(404)
      expect((await call('/operator-keys/nope', { session: 'operator', method: 'DELETE' })).status).toBe(404)
    })

    it('of two simultaneous revokes, one succeeds and one is told it is already revoked', async () => {
      const { key } = await create('revoked twice at once')

      const results = await Promise.all([1, 2].map(() => call(`/operator-keys/${key['id']}`, { session: 'operator', method: 'DELETE' })))

      expect(results.map((r) => r.status).sort()).toEqual([200, 404])
    })

    it('a tenant manager, a tenant key and nobody cannot manage operator keys', async () => {
      expect((await call('/operator-keys', { session: 'manager' })).status).toBe(403)
      expect((await call('/operator-keys', { bearer: tenantKey })).status).toBe(403)
      expect((await call('/operator-keys')).status).toBe(401)
    })

    it('an operator key cannot create, list or revoke keys (it could make itself a replacement)', async () => {
      const { plaintext, key } = await create('the mint', { session: 'operator' })

      const attempts = [
        await call('/operator-keys', { bearer: plaintext, body: { name: `${prefix} backup` } }),
        await call('/operator-keys', { bearer: plaintext }),
        await call(`/operator-keys/${key['id']}`, { bearer: plaintext, method: 'DELETE' }),
      ]

      for (const res of attempts) {
        expect(res.status).toBe(403)
        expect(res.body['message']).toMatch(/operator key cannot manage operator keys/i)
      }
      expect((await store.list()).some((k) => k.name === `${prefix} backup`)).toBe(false)
    })
  })

  // ─── using ─────────────────────────────────────────────────────────────────

  describe('using a key', () => {
    it('reaches what operators reach: tenants and people administration', async () => {
      const { plaintext } = await create('works')

      expect((await call('/tenants', { bearer: plaintext })).status).toBe(200)
      const people = await call('/people', { bearer: plaintext })
      expect(people.status).toBe(200)
      expect(people.body['principal']).toBe('operatorKey')
    })

    it('does NOT reach a tenant\'s own data: it is not a tenant credential', async () => {
      const { plaintext } = await create('no tenant data')

      expect((await call('/definitions', { bearer: plaintext })).status).toBe(401)
    })

    it('a tenant key is not an operator key: it cannot reach /tenants', async () => {
      expect((await call('/tenants', { bearer: tenantKey })).status).toBe(403)
    })

    it('stops working at once when revoked', async () => {
      const { plaintext, key } = await create('revoked soon')
      expect((await call('/tenants', { bearer: plaintext })).status).toBe(200)

      await call(`/operator-keys/${key['id']}`, { session: 'operator', method: 'DELETE' })

      expect((await call('/tenants', { bearer: plaintext })).status).toBe(403)
    })

    it('stops working when it expires', async () => {
      const { plaintext, key } = await create('expires', { session: 'operator' }, { expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
      expect((await call('/tenants', { bearer: plaintext })).status).toBe(200)

      await sql`UPDATE public.operator_keys SET expires_at = now() - interval '1 second' WHERE id = ${key['id']}`

      expect((await call('/tenants', { bearer: plaintext })).status).toBe(403)
    })

    it('an unknown or malformed operator key is refused, and the admin key still works', async () => {
      expect((await call('/tenants', { bearer: 'nxop_' + 'f'.repeat(64) })).status).toBe(403)
      expect((await call('/tenants', { bearer: 'nxop_' })).status).toBe(403)
      expect((await call('/tenants', { bearer: ADMIN_KEY })).status).toBe(200)
    })
  })

  // ─── what a key may not do to people ───────────────────────────────────────

  describe('people: an operator key cannot reach platform administration through them', () => {
    const email = (name: string) => `${prefix}.${name}@example.com`.toLowerCase()
    let key = ''

    beforeAll(async () => {
      key = (await create('people key')).plaintext
    })

    const usersCount = async () => (await sql`SELECT count(*)::int AS n FROM public.users WHERE email LIKE ${prefix + '.esc%'}`)[0]!['n'] as number

    it('cannot create a person with the operator role', async () => {
      const res = await call('/users', { bearer: key, body: { email: email('esc-new'), name: 'Escalation', memberships: [{ role: 'operator' }] } })

      expect(res.status).toBe(403)
      expect(res.body['message']).toMatch(/operator key cannot grant the operator role/i)
      expect(await usersCount()).toBe(0) // nobody was created, not even half-way
    })

    it('cannot give anyone the operator role', async () => {
      const target = await users.createUser({ email: email('esc-target'), name: 'Target' })

      const res = await call(`/users/${target.id}/memberships`, { bearer: key, body: { role: 'operator' } })

      expect(res.status).toBe(403)
      expect((await users.listMemberships(target.id)).some((m) => m.role === 'operator')).toBe(false)
    })

    it('cannot take over an operator\'s account by re-issuing their invite', async () => {
      const res = await call(`/users/${id['operator']}/invite`, { bearer: key, method: 'POST', body: {} })

      expect(res.status).toBe(403)
      expect(res.body).not.toHaveProperty('invite') // no link came back
    })

    it('a signed-in operator can still do all three (the restriction is for keys)', async () => {
      const created = await call('/users', { session: 'operator', body: { email: email('esc-by-person'), name: 'By person', memberships: [{ role: 'operator' }] } })
      expect(created.status).toBe(201)
      const reinvited = await call(`/users/${created.body['user'].id}/invite`, { session: 'operator', method: 'POST', body: {} })
      expect(reinvited.status).toBe(200)
    })

    it('and so can the admin key, which is the break-glass credential', async () => {
      const res = await call('/users', { bearer: ADMIN_KEY, body: { email: email('esc-by-admin'), name: 'By admin', memberships: [{ role: 'operator' }] } })
      expect(res.status).toBe(201)
    })

    it('can still provision the people of tenants: create a tenant manager, invite them, offboard them', async () => {
      const created = await call('/users', { bearer: key, body: { email: email('esc-ok'), name: 'Customer', memberships: [{ role: 'tenant_manager', tenantId: tenant }] } })
      expect(created.status).toBe(201)
      const personId: string = created.body['user'].id

      expect((await call(`/users/${personId}/invite`, { bearer: key, method: 'POST', body: {} })).status).toBe(200)
      expect((await call(`/users/${personId}`, { bearer: key, method: 'PATCH', body: { status: 'disabled' } })).status).toBe(200)
      const memberships = await users.listMemberships(personId)
      expect((await call(`/users/${personId}/memberships/${memberships[0]!.id}`, { bearer: key, method: 'DELETE' })).status).toBe(200)
    })

    it('what it did is in the audit log under its own name, so it can be found and undone after a revoke', async () => {
      const [created] = await sql<Array<{ actor_kind: string; target: string | null }>>`
        SELECT actor_kind, target FROM public.audit_log WHERE action = 'user.create' AND details::text LIKE ${'%' + email('esc-ok') + '%'}`

      expect(created?.actor_kind).toBe('operatorKey')
    })
  })

  // ─── the audit log ─────────────────────────────────────────────────────────

  describe('audit log', () => {
    it('records creating and revoking, with who and the key, never the secret', async () => {
      recorded.length = 0
      const { key, plaintext } = await create('audited')
      await call(`/operator-keys/${key['id']}`, { session: 'operator', method: 'DELETE' })

      const created = recorded.find((e) => e['action'] === 'operator-key.create' && e['target'] === key['id'])
      const revoked = recorded.find((e) => e['action'] === 'operator-key.revoke' && e['target'] === key['id'])
      expect(created).toMatchObject({ actor: { kind: 'user', id: id['operator'] }, details: { name: `${prefix} audited`, expiresAt: null } })
      expect(revoked).toMatchObject({ actor: { kind: 'user', id: id['operator'] }, details: { name: `${prefix} audited` } })
      expect(JSON.stringify(recorded)).not.toContain(plaintext)
    })

    it('creates no key, and revokes none, when the audit entry cannot be written', async () => {
      const { key } = await create('fail-closed')
      const before = (await store.list()).length
      vi.mocked(audit.recordStrict).mockRejectedValueOnce(new Error('audit down')).mockRejectedValueOnce(new Error('audit down'))

      const created = await call('/operator-keys', { session: 'operator', body: { name: `${prefix} never` } })
      const revoked = await call(`/operator-keys/${key['id']}`, { session: 'operator', method: 'DELETE' })

      expect(created.status).toBe(500)
      expect(revoked.status).toBe(500)
      expect((await store.list()).length).toBe(before)
      expect((await store.list()).find((k) => k.id === key['id'])?.revokedAt).toBeNull()
    })

    it('changes nothing about a person when the audit entry cannot be written', async () => {
      const person = await users.createUser({ email: `${prefix}.failclosed@example.com`, name: 'Fail closed' })
      const membership = await users.addMembership(person.id, 'tenant_manager', tenant)
      const down = () => vi.mocked(audit.recordStrict).mockRejectedValueOnce(new Error('audit down'))

      down()
      const disabled = await call(`/users/${person.id}`, { session: 'operator', method: 'PATCH', body: { status: 'disabled' } })
      down()
      const removed = await call(`/users/${person.id}/memberships/${membership.id}`, { session: 'operator', method: 'DELETE' })
      down()
      const granted = await call(`/users/${person.id}/memberships`, { session: 'operator', body: { role: 'operator', tenantId: null } })
      down()
      const invited = await call(`/users/${person.id}/invite`, { session: 'operator', body: {} })
      down()
      const made = await call('/users', { session: 'operator', body: { email: `${prefix}.never@example.com`, name: 'Never', memberships: [] } })

      expect([disabled.status, removed.status, granted.status, invited.status, made.status]).toEqual([500, 500, 500, 500, 500])
      expect((await users.findById(person.id))?.status).toBe('active')
      expect((await users.listMemberships(person.id)).map((m) => m.role)).toEqual(['tenant_manager'])
      const [invites] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM public.invites WHERE user_id = ${person.id}`
      expect(invites?.n).toBe(0)
      expect(await users.findByEmail(`${prefix}.never@example.com`)).toBeNull()
      await users.deleteUser(person.id)
    })

    it('records what an operator key does under its own name', async () => {
      const { key, plaintext } = await create('actor')
      recorded.length = 0

      await call('/tenants', { bearer: plaintext, body: { id: `${prefix}_x`, name: 'Made by a key' } })

      const entry = recorded.find((e) => e['action'] === 'tenant.create')
      expect(entry?.['actor']).toEqual({ kind: 'operatorKey', id: key['id'], label: `${prefix} actor` })
      // and the database accepts that kind of actor
      const [row] = await sql`SELECT actor_kind, actor_id FROM public.audit_log WHERE action = 'tenant.create' AND target = ${prefix + '_x'}`
      expect(row).toMatchObject({ actor_kind: 'operatorKey', actor_id: key['id'] })
      // the tenant was provisioned (a schema was created): drop it, not just its registry row
      await dropTenantSchema(`${prefix}_x`, sql)
      await sql`DELETE FROM public.tenants WHERE id = ${prefix + '_x'}`
    })
  })
})
