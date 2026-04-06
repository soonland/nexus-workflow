import { Hono } from 'hono'
import type postgres from 'postgres'
import { TenantStore } from '../db/TenantStore.js'
import { provisionTenantSchema } from '../db/tenantProvisioner.js'

// ─── Admin auth helper ────────────────────────────────────────────────────────

function checkAdminAuth(authHeader: string | undefined, adminApiKey: string): boolean {
  if (!authHeader) return false
  const [scheme, key] = authHeader.split(' ')
  return scheme === 'Bearer' && !!key && key === adminApiKey
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function createTenantsRouter(sql: postgres.Sql, hmacSecret: string, adminApiKey: string): Hono {
  const app = new Hono()
  const store = new TenantStore(sql, hmacSecret)

  // ─── Admin auth guard ─────────────────────────────────────────────────────

  app.use('*', async (c, next) => {
    if (!checkAdminAuth(c.req.header('Authorization'), adminApiKey)) {
      return c.json({ error: 'FORBIDDEN', message: 'Admin API key required' }, 403)
    }
    return next()
  })

  // ─── POST /tenants ────────────────────────────────────────────────────────

  app.post('/', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid JSON body' }, 400)
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return c.json({ error: 'VALIDATION_ERROR', message: 'Body must be a JSON object' }, 400)
    }

    const { id, name } = body as Record<string, unknown>

    if (typeof id !== 'string' || id.trim() === '') {
      return c.json({ error: 'VALIDATION_ERROR', message: '"id" must be a non-empty string' }, 400)
    }
    if (typeof name !== 'string' || name.trim() === '') {
      return c.json({ error: 'VALIDATION_ERROR', message: '"name" must be a non-empty string' }, 400)
    }

    // Provision fails fast if id contains invalid characters
    try {
      await provisionTenantSchema(id, sql)
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Invalid tenantId')) {
        return c.json({ error: 'VALIDATION_ERROR', message: e.message }, 400)
      }
      throw e
    }

    try {
      const tenant = await store.createTenant(id, name)
      return c.json({ tenant }, 201)
    } catch (e) {
      // Unique violation: tenant id already exists
      if (e instanceof Error && 'code' in e && (e as NodeJS.ErrnoException).code === '23505') {
        return c.json({ error: 'CONFLICT', message: `Tenant '${id}' already exists` }, 409)
      }
      throw e
    }
  })

  // ─── GET /tenants/:id ─────────────────────────────────────────────────────

  app.get('/:id', async (c) => {
    const id = c.req.param('id')
    const tenant = await store.getTenant(id)
    if (!tenant) return c.json({ error: 'NOT_FOUND', message: `Tenant '${id}' not found` }, 404)
    return c.json({ tenant })
  })

  // ─── POST /tenants/:id/keys ───────────────────────────────────────────────

  app.post('/:id/keys', async (c) => {
    const tenantId = c.req.param('id')

    const tenant = await store.getTenant(tenantId)
    if (!tenant) return c.json({ error: 'NOT_FOUND', message: `Tenant '${tenantId}' not found` }, 404)

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid JSON body' }, 400)
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return c.json({ error: 'VALIDATION_ERROR', message: 'Body must be a JSON object' }, 400)
    }

    const { name } = body as Record<string, unknown>
    if (typeof name !== 'string' || name.trim() === '') {
      return c.json({ error: 'VALIDATION_ERROR', message: '"name" must be a non-empty string' }, 400)
    }

    const { key, plaintext } = await store.createApiKey(tenantId, name)
    return c.json({ key, plaintext }, 201)
  })

  // ─── GET /tenants/:id/keys ────────────────────────────────────────────────

  app.get('/:id/keys', async (c) => {
    const tenantId = c.req.param('id')

    const tenant = await store.getTenant(tenantId)
    if (!tenant) return c.json({ error: 'NOT_FOUND', message: `Tenant '${tenantId}' not found` }, 404)

    const keys = await store.listApiKeys(tenantId)
    return c.json({ keys })
  })

  // ─── DELETE /tenants/:id/keys/:keyId ─────────────────────────────────────

  app.delete('/:id/keys/:keyId', async (c) => {
    const tenantId = c.req.param('id')
    const keyId = c.req.param('keyId')

    const tenant = await store.getTenant(tenantId)
    if (!tenant) return c.json({ error: 'NOT_FOUND', message: `Tenant '${tenantId}' not found` }, 404)

    const revoked = await store.revokeApiKey(tenantId, keyId)
    if (!revoked) return c.json({ error: 'NOT_FOUND', message: `Key '${keyId}' not found or already revoked` }, 404)

    return c.json({ success: true })
  })

  return app
}
