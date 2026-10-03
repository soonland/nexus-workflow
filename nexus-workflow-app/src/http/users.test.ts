import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import postgres from 'postgres'
import { UserAdmin } from '../auth/UserAdmin.js'
import { InviteStore } from '../db/InviteStore.js'
import { runMigrations } from '../db/migrate.js'
import { SessionStore } from '../db/SessionStore.js'
import { TenantStore } from '../db/TenantStore.js'
import { UserStore } from '../db/UserStore.js'
import { createPeopleAdminGuard } from './middleware/operator.js'
import { createUsersRouter } from './users.js'

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'
const HMAC = 'users-router-secret'
const ADMIN_KEY = 'users-router-admin-key'

describe('users HTTP API (Postgres)', () => {
  const prefix = `ur_${crypto.randomUUID().slice(0, 6)}`
  const tenantA = `${prefix}_a`
  const tenantB = `${prefix}_b`
  const email = (name: string) => `${prefix}.${name}@example.com`
  let sql: postgres.Sql
  let users: UserStore
  let app: Hono
  const cookie: Record<string, string> = {}
  let keyOfA = ''

  beforeAll(async () => {
    await runMigrations(DATABASE_URL)
    sql = postgres(DATABASE_URL)
    users = new UserStore(sql)
    const sessions = new SessionStore(sql, { hmacSecret: HMAC, idleMs: 30 * 60_000, maxMs: 24 * 3_600_000 })
    const tenants = new TenantStore(sql, HMAC)
    await tenants.createTenant(tenantA, 'A')
    await tenants.createTenant(tenantB, 'B')
    keyOfA = (await tenants.createApiKey(tenantA, 'service')).plaintext

    const make = async (name: string, roles: Array<['operator', null] | ['tenant_manager', string]>) => {
      const user = await users.createUser({ email: email(name), name })
      for (const [role, tenantId] of roles) await users.addMembership(user.id, role, tenantId)
      cookie[name] = `nexus_session=${(await sessions.create(user.id, {})).token}`
    }
    await make('operator', [['operator', null]])
    await make('managerA', [['tenant_manager', tenantA]])
    await make('managerB', [['tenant_manager', tenantB]])
    await make('nobody', [])

    app = new Hono()
    app.route(
      '/users',
      createUsersRouter({
        admin: new UserAdmin(users, new InviteStore(sql, { hmacSecret: HMAC, ttlMs: 24 * 3_600_000 })),
        guard: createPeopleAdminGuard({ adminApiKey: ADMIN_KEY, sessions, users }),
      }),
    )
  })

  afterAll(async () => {
    await sql`DELETE FROM public.users WHERE email LIKE ${prefix + '.%'}`
    await sql`DELETE FROM public.api_keys WHERE tenant_id LIKE ${prefix + '%'}`
    await sql`DELETE FROM public.tenants WHERE id LIKE ${prefix + '%'}`
    await sql.end()
  })

  // ─── helpers ───────────────────────────────────────────────────────────────

  interface Call {
    method?: string
    as?: string
    bearer?: string
    body?: unknown
    csrf?: boolean
  }

  async function call(path: string, c: Call = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (c.as) headers['Cookie'] = cookie[c.as]!
    if (c.bearer) headers['Authorization'] = `Bearer ${c.bearer}`
    if (c.csrf ?? true) {
      headers['X-Nexus-Console'] = '1'
      headers['Origin'] = 'http://localhost'
    }
    const method = c.method ?? 'GET'
    const res = await app.fetch(
      new Request(`http://localhost/users${path}`, { method, headers, ...(c.body !== undefined ? { body: JSON.stringify(c.body) } : {}) }),
    )
    return { res, status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> }
  }

  const invite = (name: string, as: string, memberships?: unknown) =>
    call('', { method: 'POST', as, body: { email: email(name), name, ...(memberships ? { memberships } : {}) } })

  // ─── who gets in at all ────────────────────────────────────────────────────

  describe('access', () => {
    it('anonymous callers get 401', async () => {
      expect((await call('')).status).toBe(401)
    })

    it.each([
      ['a user with no roles', { as: 'nobody' }],
      ['a tenant API key', { bearer: 'KEY' }],
      ['a wrong admin key', { bearer: 'wrong' }],
    ])('refuses %s with 403', async (_label, c) => {
      expect((await call('', c.bearer === 'KEY' ? { bearer: keyOfA } : c)).status).toBe(403)
    })

    it.each([['an operator', { as: 'operator' }], ['a tenant manager', { as: 'managerA' }], ['the admin key', { bearer: ADMIN_KEY }]])(
      'lets in %s',
      async (_label, c) => {
        expect((await call('', c)).status).toBe(200)
      },
    )

    it('protects state-changing calls made with a session against cross-site forgery', async () => {
      const forged = await call('', { method: 'POST', as: 'operator', body: { email: email('forged'), name: 'Forged' }, csrf: false })
      expect(forged.status).toBe(403)
      expect(await users.findByEmail(email('forged'))).toBeNull()
    })

    it('does not cache anything (invite tokens are in the responses)', async () => {
      expect((await call('', { as: 'operator' })).res.headers.get('cache-control')).toBe('no-store')
    })
  })

  // ─── creating ──────────────────────────────────────────────────────────────

  describe('POST /users', () => {
    it('an operator invites someone and gets the one-time link back', async () => {
      const { status, body } = await invite('ada', 'operator', [{ role: 'tenant_manager', tenantId: tenantA }])

      expect(status).toBe(201)
      expect(body['user']).toMatchObject({ email: email('ada'), name: 'ada', status: 'active', hasPassword: false })
      expect(body['user'].memberships).toMatchObject([{ role: 'tenant_manager', tenantId: tenantA }])
      expect(body['invite'].token).toMatch(/^[A-Za-z0-9_-]{43}$/)
      // only a path, unless PUBLIC_ORIGIN is configured: the console adds its own origin
      expect(body['invite'].path).toBe(`/console/invite/${body['invite'].token}`)
      expect(body['invite']).not.toHaveProperty('url')
      expect(Date.parse(body['invite'].expiresAt)).toBeGreaterThan(Date.now())
      expect(JSON.stringify(body)).not.toMatch(/passwordHash|scrypt/)
    })

    it('never builds a link from the Host header: a spoofed host cannot end up in an invite link', async () => {
      const spoofed = (headers: Record<string, string> = {}) =>
        app.fetch(
          new Request('http://evil.example.com/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_KEY}`, 'X-Forwarded-Host': 'evil.example.com', ...headers },
            body: JSON.stringify({ email: email(`spoof${Math.random().toString(36).slice(2, 6)}`), name: 'Spoof' }),
          }),
        )

      const created = await spoofed()
      const text = await created.text()

      expect(created.status).toBe(201)
      expect(text).not.toContain('evil.example.com')
      expect(JSON.parse(text).invite.path).toMatch(/^\/console\/invite\//)

      // the same for a re-issued invite
      const userId = JSON.parse(text).user.id as string
      const reissued = await app.fetch(
        new Request(`http://evil.example.com/users/${userId}/invite`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'X-Forwarded-Host': 'evil.example.com' },
        }),
      )
      expect(await reissued.text()).not.toContain('evil.example.com')
    })

    it('builds the link from PUBLIC_ORIGIN when it is set', async () => {
      const behindProxy = new Hono()
      behindProxy.route(
        '/users',
        createUsersRouter({
          admin: new UserAdmin(users, new InviteStore(sql, { hmacSecret: HMAC, ttlMs: 3_600_000 })),
          guard: createPeopleAdminGuard({ adminApiKey: ADMIN_KEY, sessions: new SessionStore(sql, { hmacSecret: HMAC, idleMs: 60_000, maxMs: 3_600_000 }), users }),
          publicOrigin: 'https://workflow.example.com',
        }),
      )
      const res = await behindProxy.fetch(
        new Request('http://internal:3000/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_KEY}` },
          body: JSON.stringify({ email: email('origin'), name: 'Origin' }),
        }),
      )
      const body = (await res.json()) as any
      expect(body.invite.url).toBe(`https://workflow.example.com/console/invite/${body.invite.token}`)
      expect(body.invite.path).toBe(`/console/invite/${body.invite.token}`)
    })

    it('a tenant manager can invite a manager for their own tenant', async () => {
      const { status } = await invite('colleague', 'managerA', [{ role: 'tenant_manager', tenantId: tenantA }])
      expect(status).toBe(201)
    })

    it.each([
      ['grant operator', [{ role: 'operator', tenantId: null }]],
      ['grant another tenant', [{ role: 'tenant_manager', tenantId: 'TENANT_B' }]],
      ['give no tenant at all', undefined],
    ] as const)('a tenant manager cannot %s (403)', async (_label, memberships) => {
      const real = memberships?.map((m) => ({ ...m, tenantId: m.tenantId === 'TENANT_B' ? tenantB : m.tenantId }))
      const { status } = await invite(`mgr-denied-${_label.length}`, 'managerA', real)
      expect(status).toBe(403)
      expect(await users.findByEmail(email(`mgr-denied-${_label.length}`))).toBeNull()
    })

    it('409 when the email is taken, 400 when something is wrong with the request', async () => {
      expect((await invite('operator', 'operator')).status).toBe(409)
      expect((await call('', { method: 'POST', as: 'operator', body: { email: 'not-an-email', name: 'X' } })).status).toBe(400)
      expect((await invite('badtenant', 'operator', [{ role: 'tenant_manager', tenantId: `${prefix}_missing` }])).status).toBe(400)
    })

    it.each([
      ['no fields', {}],
      ['a non-string email', { email: 5, name: 'X' }],
      ['a non-string name', { email: 'a@b.co', name: 5 }],
      ['memberships that are not a list', { email: 'a@b.co', name: 'X', memberships: 'operator' }],
      ['a membership with an unknown role', { email: 'a@b.co', name: 'X', memberships: [{ role: 'root', tenantId: null }] }],
      ['a membership with a non-string tenant', { email: 'a@b.co', name: 'X', memberships: [{ role: 'tenant_manager', tenantId: 5 }] }],
      ['an array body', []],
    ])('400 for %s', async (_label, body) => {
      expect((await call('', { method: 'POST', as: 'operator', body })).status).toBe(400)
    })

    it('400 for a body that is not JSON', async () => {
      const res = await app.fetch(
        new Request('http://localhost/users', { method: 'POST', headers: { Cookie: cookie['operator']!, 'X-Nexus-Console': '1', Origin: 'http://localhost' }, body: 'nope' }),
      )
      expect(res.status).toBe(400)
    })
  })

  // ─── reading, changing ─────────────────────────────────────────────────────

  describe('reading and changing people', () => {
    let personId: string
    let outsiderId: string

    beforeAll(async () => {
      personId = (await invite('person', 'operator', [{ role: 'tenant_manager', tenantId: tenantA }])).body['user'].id
      outsiderId = (await invite('outsider', 'operator', [{ role: 'tenant_manager', tenantId: tenantB }])).body['user'].id
    })

    it('GET /users lists what the caller may see', async () => {
      const asManager = (await call('', { as: 'managerA' })).body['users'].map((u: any) => u.id)
      expect(asManager).toContain(personId)
      expect(asManager).not.toContain(outsiderId)
      const asOperator = (await call('', { as: 'operator' })).body['users'].map((u: any) => u.id)
      expect(asOperator).toEqual(expect.arrayContaining([personId, outsiderId]))
    })

    it('GET /users/:id: 200 in scope, 404 out of scope or unknown', async () => {
      expect((await call(`/${personId}`, { as: 'managerA' })).status).toBe(200)
      expect((await call(`/${outsiderId}`, { as: 'managerA' })).status).toBe(404)
      expect((await call(`/${'0'.repeat(32)}`, { as: 'operator' })).status).toBe(404)
    })

    it('PATCH /users/:id disables and re-enables; out-of-scope is 404; yourself is 409', async () => {
      const disabled = await call(`/${personId}`, { method: 'PATCH', as: 'managerA', body: { status: 'disabled' } })
      expect(disabled.status).toBe(200)
      expect(disabled.body['user'].status).toBe('disabled')
      expect((await call(`/${personId}`, { method: 'PATCH', as: 'managerA', body: { status: 'active' } })).body['user'].status).toBe('active')

      expect((await call(`/${outsiderId}`, { method: 'PATCH', as: 'managerA', body: { status: 'disabled' } })).status).toBe(404)
    })

    it('PATCH rejects a bad status or an empty body', async () => {
      expect((await call(`/${personId}`, { method: 'PATCH', as: 'operator', body: { status: 'deleted' } })).status).toBe(400)
      expect((await call(`/${personId}`, { method: 'PATCH', as: 'operator', body: {} })).status).toBe(400)
    })

    it('adds and removes memberships', async () => {
      const added = await call(`/${personId}/memberships`, { method: 'POST', as: 'operator', body: { role: 'tenant_manager', tenantId: tenantB } })
      expect(added.status).toBe(201)
      expect(added.body['membership']).toMatchObject({ role: 'tenant_manager', tenantId: tenantB })

      const removed = await call(`/${personId}/memberships/${added.body['membership'].id}`, { method: 'DELETE', as: 'operator' })
      expect(removed.status).toBe(200)
      expect((await call(`/${personId}/memberships/${added.body['membership'].id}`, { method: 'DELETE', as: 'operator' })).status).toBe(404)
    })

    it('a manager cannot grant operator (403) or reach a membership of someone out of scope (404)', async () => {
      expect((await call(`/${personId}/memberships`, { method: 'POST', as: 'managerA', body: { role: 'operator', tenantId: null } })).status).toBe(403)
      expect((await call(`/${outsiderId}/memberships`, { method: 'POST', as: 'managerA', body: { role: 'tenant_manager', tenantId: tenantA } })).status).toBe(404)
    })

    it('rejects a malformed membership', async () => {
      expect((await call(`/${personId}/memberships`, { method: 'POST', as: 'operator', body: { role: 'tenant_manager' } })).status).toBe(400)
      expect((await call(`/${personId}/memberships`, { method: 'POST', as: 'operator', body: { role: 'root', tenantId: null } })).status).toBe(400)
    })

    it('POST /users/:id/invite issues a fresh link and the old one stops working', async () => {
      const first = (await invite('reinv', 'managerA', [{ role: 'tenant_manager', tenantId: tenantA }])).body
      const second = await call(`/${first['user'].id}/invite`, { method: 'POST', as: 'managerA' })

      expect(second.status).toBe(200)
      expect(second.body['invite'].token).not.toBe(first['invite'].token)
      expect(second.body['invite'].path).toBe(`/console/invite/${second.body['invite'].token}`)
      expect((await call(`/${outsiderId}/invite`, { method: 'POST', as: 'managerA' })).status).toBe(404)
    })
  })

  describe('guard rails', () => {
    it('nobody can disable themselves (409), and the admin key can disable anyone it can see', async () => {
      const me = (await call('', { as: 'operator' })).body['users'].find((u: any) => u.email === email('operator'))
      expect((await call(`/${me.id}`, { method: 'PATCH', as: 'operator', body: { status: 'disabled' } })).status).toBe(409)
      const other = (await invite('byadmin', 'operator', [{ role: 'tenant_manager', tenantId: tenantA }])).body['user'].id
      expect((await call(`/${other}`, { method: 'PATCH', bearer: ADMIN_KEY, body: { status: 'disabled' } })).status).toBe(200)
    })

    it('nobody can strip their own operator role (409)', async () => {
      const me = (await call('', { as: 'operator' })).body['users'].find((u: any) => u.email === email('operator'))
      const membership = me.memberships.find((m: any) => m.role === 'operator')
      expect((await call(`/${me.id}/memberships/${membership.id}`, { method: 'DELETE', as: 'operator' })).status).toBe(409)
    })
  })
})
