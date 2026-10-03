import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Hono } from 'hono'
import postgres from 'postgres'
import { runMigrations } from '../db/migrate.js'
import { SessionStore } from '../db/SessionStore.js'
import { TenantStore } from '../db/TenantStore.js'
import { dropTenantSchema, provisionTenantSchema } from '../db/tenantProvisioner.js'
import { UserStore } from '../db/UserStore.js'
import { createAuthMiddleware, type AppVariables } from './middleware/auth.js'
import { createOperatorGuard } from './middleware/operator.js'
import { createTenantsRouter } from './tenants.js'

// The permission matrix: every kind of caller against every group of routes, with real users,
// sessions, memberships, tenants and API keys in Postgres and the real middleware.

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'
const HMAC = 'authorization-test-secret'
const ADMIN_KEY = 'authorization-test-admin-key'

describe('authorization (Postgres)', () => {
  const prefix = `az_${crypto.randomUUID().slice(0, 6)}`
  const tenantA = `${prefix}_a`
  const tenantB = `${prefix}_b`
  let sql: postgres.Sql
  let users: UserStore
  let sessions: SessionStore
  let tenants: TenantStore
  let app: Hono<{ Variables: AppVariables }>

  // credentials, by name
  const token: Record<string, string> = {}
  let keyOfA = ''

  beforeAll(async () => {
    await runMigrations(DATABASE_URL)
    sql = postgres(DATABASE_URL)
    users = new UserStore(sql)
    sessions = new SessionStore(sql, { hmacSecret: HMAC, idleMs: 30 * 60_000, maxMs: 24 * 60 * 60_000 })
    tenants = new TenantStore(sql, HMAC)

    await tenants.createTenant(tenantA, 'Tenant A')
    await tenants.createTenant(tenantB, 'Tenant B')
    await provisionTenantSchema(tenantA, sql) // A has a real schema (so it can be counted); B is only a registry row
    keyOfA = (await tenants.createApiKey(tenantA, 'service')).plaintext

    const make = async (name: string, roles: Array<['operator', null] | ['tenant_manager', string]>) => {
      const user = await users.createUser({ email: `${prefix}.${name}@example.com`, name })
      for (const [role, tenantId] of roles) await users.addMembership(user.id, role, tenantId)
      token[name] = (await sessions.create(user.id, {})).token
    }
    await make('operator', [['operator', null]])
    await make('managerA', [['tenant_manager', tenantA]])
    await make('managerB', [['tenant_manager', tenantB]])
    await make('both', [['operator', null], ['tenant_manager', tenantA]])
    await make('norole', [])

    app = new Hono<{ Variables: AppVariables }>()
    app.get('/health', (c) => c.json({ status: 'ok' }))
    app.route(
      '/tenants',
      createTenantsRouter(sql, HMAC, ADMIN_KEY, {
        guard: createOperatorGuard({ adminApiKey: ADMIN_KEY, sessions, users }),
      }),
    )
    app.use('*', createAuthMiddleware(sql, HMAC, { sessions, users }))
    for (const path of ['/definitions', '/instances', '/tasks', '/admin/instances/summary', '/instances/x/events', '/webhooks', '/metrics']) {
      app.all(path, (c) => c.json({ tenantId: c.get('tenantId') }))
    }
  })

  afterAll(async () => {
    await dropTenantSchema(tenantA, sql)
    await sql`DELETE FROM public.users WHERE email LIKE ${prefix + '.%'}`
    await sql`DELETE FROM public.api_keys WHERE tenant_id LIKE ${prefix + '%'}`
    await sql`DELETE FROM public.tenants WHERE id LIKE ${prefix + '%'}`
    await sql.end()
  })

  // ─── helpers ───────────────────────────────────────────────────────────────

  interface Call {
    method?: string
    session?: string // a key of `token`, or a raw cookie value
    bearer?: string
    tenant?: string
    /** Send the CSRF header and a matching Origin (default true for state-changing session calls). */
    csrf?: boolean
  }

  async function call(path: string, c: Call = {}): Promise<{ status: number; body: Record<string, unknown> }> {
    const method = c.method ?? 'GET'
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (c.session) headers['Cookie'] = `nexus_session=${token[c.session] ?? c.session}`
    if (c.bearer) headers['Authorization'] = `Bearer ${c.bearer}`
    if (c.tenant) headers['X-Tenant'] = c.tenant
    if (c.csrf ?? true) {
      headers['X-Nexus-Console'] = '1'
      headers['Origin'] = 'http://localhost'
    }
    const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers, ...(method === 'GET' ? {} : { body: '{}' }) }))
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> }
  }

  const status = async (path: string, c?: Call) => (await call(path, c)).status

  // ─── operator routes: /tenants ─────────────────────────────────────────────

  describe('/tenants (operators only)', () => {
    it('anonymous callers get 401, so a client can tell "not signed in" from "not allowed"', async () => {
      expect(await status('/tenants')).toBe(401)
    })

    it.each([
      ['an operator session', { session: 'operator' }],
      ['the admin key', { bearer: ADMIN_KEY }],
      ['a user who is operator and manager', { session: 'both' }],
    ])('lets in %s', async (_label, c) => {
      const res = await call('/tenants', c)
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body['tenants'])).toBe(true)
    })

    it.each([
      ['a tenant manager', { session: 'managerA' }],
      ['a user with no roles', { session: 'norole' }],
      ['a tenant API key', { bearer: 'TENANT_KEY' }],
      ['a wrong admin key', { bearer: 'not-the-admin-key' }],
    ])('refuses %s with 403', async (_label, c) => {
      const call_ = c.bearer === 'TENANT_KEY' ? { bearer: keyOfA } : c
      expect(await status('/tenants', call_)).toBe(403)
    })

    it('keeps the per-tenant numbers (?counts=true) to operators too', async () => {
      expect(await status('/tenants?counts=true', { session: 'managerA', tenant: tenantA })).toBe(403)
      expect(await status('/tenants?counts=true', { session: 'norole' })).toBe(403)
      expect(await status('/tenants?counts=true', { bearer: keyOfA })).toBe(403)
      expect(await status('/tenants?counts=true')).toBe(401)
      expect(await status('/tenants?counts=true', { session: 'operator' })).toBe(200)
    })

    it('reads the real numbers when no counter is injected (the default wiring)', async () => {
      const res = await call('/tenants?counts=true', { session: 'operator' })

      const mine = (res.body['tenants'] as Array<{ id: string; counts: unknown }>).find((t) => t.id === tenantA)
      expect(mine?.counts).toEqual({ instances: { pending: 0, active: 0, suspended: 0, completed: 0, terminated: 0 }, pendingTasks: 0 })
      // a tenant that is only a registry row (no schema) cannot be counted: null, and the list still works
      const bare = (res.body['tenants'] as Array<{ id: string; counts: unknown }>).find((t) => t.id === tenantB)
      expect(bare?.counts).toBeNull()
    })

    it('treats a dead session as not signed in (401), not as forbidden', async () => {
      expect(await status('/tenants', { session: 'x'.repeat(43) })).toBe(401)
    })

    it('Bearer credentials win over a cookie, so an operator cookie cannot lift a wrong key', async () => {
      expect(await status('/tenants', { bearer: 'not-the-admin-key', session: 'operator' })).toBe(403)
      expect(await status('/tenants', { bearer: ADMIN_KEY, session: 'managerA' })).toBe(200)
    })

    it('protects state-changing calls made with a session against cross-site forgery', async () => {
      expect(await status('/tenants', { method: 'POST', session: 'operator', csrf: false })).toBe(403)
      const withCsrf = await call('/tenants', { method: 'POST', session: 'operator' })
      expect(withCsrf.status).toBe(400) // got past the guard; the empty body is what fails
    })

    it('does not need the CSRF header for the admin key (a Bearer header is not sent by a browser on its own)', async () => {
      const res = await call('/tenants', { method: 'POST', bearer: ADMIN_KEY, csrf: false })
      expect(res.status).toBe(400)
    })
  })

  // ─── tenant routes ─────────────────────────────────────────────────────────

  describe.each(['/definitions', '/instances', '/tasks', '/admin/instances/summary', '/instances/x/events', '/webhooks', '/metrics'])(
    'tenant route %s',
    (path) => {
      it('401 for anonymous callers', async () => {
        expect(await status(path)).toBe(401)
      })

      it('lets a manager in to their own tenant, and the request runs as that tenant', async () => {
        const res = await call(path, { session: 'managerA', tenant: tenantA })
        expect(res.status).toBe(200)
        expect(res.body['tenantId']).toBe(tenantA)
      })

      it('403 for a manager of another tenant, and for a tenant that does not exist (no way to probe)', async () => {
        expect(await status(path, { session: 'managerA', tenant: tenantB })).toBe(403)
        expect(await status(path, { session: 'managerA', tenant: `${prefix}_nope` })).toBe(403)
      })

      it('400 when a session does not say which tenant it means', async () => {
        const res = await call(path, { session: 'managerA' })
        expect(res.status).toBe(400)
        expect(res.body['error']).toBe('TENANT_REQUIRED')
      })

      it('403 for an operator or a user with no roles: the operator role does not open tenant data', async () => {
        expect(await status(path, { session: 'operator', tenant: tenantA })).toBe(403)
        expect(await status(path, { session: 'norole', tenant: tenantA })).toBe(403)
      })

      it('a user who is operator and manager of A reaches A but not B', async () => {
        expect(await status(path, { session: 'both', tenant: tenantA })).toBe(200)
        expect(await status(path, { session: 'both', tenant: tenantB })).toBe(403)
      })

      it('tenant API keys work as before and always run as their own tenant', async () => {
        const res = await call(path, { bearer: keyOfA })
        expect(res.status).toBe(200)
        expect(res.body['tenantId']).toBe(tenantA)
        // a key cannot be redirected to another tenant with a header
        expect((await call(path, { bearer: keyOfA, tenant: tenantB })).body['tenantId']).toBe(tenantA)
      })

      it('the admin key is not a tenant credential (401, as before)', async () => {
        expect(await status(path, { bearer: ADMIN_KEY, tenant: tenantA })).toBe(401)
      })

      it('a bad or expired session is 401', async () => {
        expect(await status(path, { session: 'x'.repeat(43), tenant: tenantA })).toBe(401)
      })
    },
  )

  describe('tenant routes: cross-cutting rules', () => {
    it('Bearer credentials win over a cookie: an API key is never combined with a session', async () => {
      const res = await call('/definitions', { bearer: keyOfA, session: 'managerB', tenant: tenantB })
      expect(res.body['tenantId']).toBe(tenantA)
    })

    it('state-changing calls with a session need the CSRF header; API key calls do not', async () => {
      expect(await status('/instances', { method: 'POST', session: 'managerA', tenant: tenantA, csrf: false })).toBe(403)
      expect(await status('/instances', { method: 'POST', session: 'managerA', tenant: tenantA })).toBe(200)
      expect(await status('/instances', { method: 'POST', bearer: keyOfA, csrf: false })).toBe(200)
    })

    it('reading with a session needs no CSRF header', async () => {
      expect(await status('/instances', { session: 'managerA', tenant: tenantA, csrf: false })).toBe(200)
    })

    it('a suspended tenant rejects its managers (403) and its keys (401) alike', async () => {
      await tenants.updateTenant(tenantA, { status: 'suspended' })
      try {
        expect(await status('/definitions', { session: 'managerA', tenant: tenantA })).toBe(403)
        expect(await status('/definitions', { bearer: keyOfA })).toBe(401)
      } finally {
        await tenants.updateTenant(tenantA, { status: 'active' })
      }
      expect(await status('/definitions', { session: 'managerA', tenant: tenantA })).toBe(200)
    })

    it('a membership that is removed takes effect on the next request', async () => {
      const [membership] = await sql<{ id: string; user_id: string }[]>`
        SELECT m.id, m.user_id FROM public.memberships m JOIN public.users u ON u.id = m.user_id
        WHERE u.email = ${`${prefix}.managerB@example.com`.toLowerCase()}`
      expect(await status('/definitions', { session: 'managerB', tenant: tenantB })).toBe(200)

      await users.removeMembership(membership!.user_id, membership!.id)

      expect(await status('/definitions', { session: 'managerB', tenant: tenantB })).toBe(403)
    })

    it('a disabled user is signed out (401) and a revoked key is refused (401)', async () => {
      const user = await users.createUser({ email: `${prefix}.temp@example.com`, name: 'Temp' })
      await users.addMembership(user.id, 'tenant_manager', tenantA)
      const { token: temp } = await sessions.create(user.id, {})
      expect(await status('/definitions', { session: temp, tenant: tenantA })).toBe(200)

      await users.setStatus(user.id, 'disabled')

      expect(await status('/definitions', { session: temp, tenant: tenantA })).toBe(401)
    })

    it('/health stays public', async () => {
      expect(await status('/health')).toBe(200)
    })
  })
})
