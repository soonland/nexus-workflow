import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import type postgres from 'postgres'
import { TenantStore } from '../db/TenantStore.js'
import { provisionTenantSchema, VALID_TENANT_ID } from '../db/tenantProvisioner.js'

// ─── Admin auth helper ────────────────────────────────────────────────────────

function checkAdminAuth(authHeader: string | undefined, adminApiKey: string): boolean {
  if (!authHeader) return false
  const [scheme, key] = authHeader.split(' ')
  if (scheme !== 'Bearer' || !key) return false
  try {
    return timingSafeEqual(Buffer.from(key), Buffer.from(adminApiKey))
  } catch {
    // Buffers of different lengths throw — treat as mismatch
    return false
  }
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
    if (name.length > 255) {
      return c.json({ error: 'VALIDATION_ERROR', message: '"name" must not exceed 255 characters' }, 400)
    }

    // Validate tenant id format before any DB operations
    if (!VALID_TENANT_ID.test(id)) {
      return c.json(
        { error: 'VALIDATION_ERROR', message: `Invalid tenantId: "${id}". Only alphanumeric characters, hyphens, and underscores are allowed.` },
        400,
      )
    }

    // Insert the row first — a unique violation (23505) bails out before any DDL runs,
    // preventing an orphaned schema with no owning tenant row.
    let tenant
    try {
      tenant = await store.createTenant(id, name)
    } catch (e) {
      if (typeof (e as { code?: unknown }).code === 'string' && (e as { code: string }).code === '23505') {
        return c.json({ error: 'CONFLICT', message: `Tenant '${id}' already exists` }, 409)
      }
      throw e
    }

    // Provision the schema. If DDL fails, delete the committed row so the
    // caller can retry — otherwise the tenant row would persist without a schema
    // and a retry would hit 409 CONFLICT with no way to recover via the API.
    try {
      await provisionTenantSchema(id, sql)
    } catch (provisionErr) {
      console.error(`[tenants] failed to provision schema for tenant '${id}':`, provisionErr)
      try {
        await store.deleteTenant(id)
      } catch (cleanupErr) {
        console.error(`[tenants] rollback deleteTenant failed for '${id}' — row may be orphaned:`, cleanupErr)
      }
      return c.json({ error: 'PROVISIONING_FAILED', message: `Failed to provision schema for tenant '${id}'` }, 500)
    }

    return c.json({ tenant }, 201)
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

    // Validate body first — avoids a DB round-trip for malformed requests
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
    if (name.length > 255) {
      return c.json({ error: 'VALIDATION_ERROR', message: '"name" must not exceed 255 characters' }, 400)
    }

    const tenant = await store.getTenant(tenantId)
    if (!tenant) return c.json({ error: 'NOT_FOUND', message: `Tenant '${tenantId}' not found` }, 404)
    if (tenant.status !== 'active') return c.json({ error: 'FORBIDDEN', message: `Tenant '${tenantId}' is not active` }, 403)

    const { key, plaintext } = await store.createApiKey(tenantId, name.trim())
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
