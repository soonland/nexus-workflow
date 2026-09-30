import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import type postgres from 'postgres'
import { TenantStore } from '../db/TenantStore.js'
import { dropTenantSchema, provisionTenantSchema, VALID_TENANT_ID } from '../db/tenantProvisioner.js'

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

export interface TenantsRouterOptions {
  /**
   * Called after a tenant has been marked suspended, and before its schema is dropped when it is
   * deleted. The host uses it to stop the tenant's background workers and release its pools.
   */
  onTenantDeactivating?: (tenantId: string) => void | Promise<void>
}

/** The tenant that owns pre-multi-tenancy data; deleting it would take the platform's history with it. */
const PROTECTED_TENANT_ID = 'default'

export function createTenantsRouter(
  sql: postgres.Sql,
  hmacSecret: string,
  adminApiKey: string,
  options: TenantsRouterOptions = {},
): Hono {
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

  // ─── GET /tenants ─────────────────────────────────────────────────────────

  app.get('/', async (c) => {
    const tenants = await store.listTenants()
    return c.json({ tenants })
  })

  // ─── GET /tenants/:id ─────────────────────────────────────────────────────

  app.get('/:id', async (c) => {
    const id = c.req.param('id')
    const tenant = await store.getTenant(id)
    if (!tenant) return c.json({ error: 'NOT_FOUND', message: `Tenant '${id}' not found` }, 404)
    return c.json({ tenant })
  })

  // ─── PATCH /tenants/:id — rename, suspend, reactivate ─────────────────────

  app.patch('/:id', async (c) => {
    const id = c.req.param('id')

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid JSON body' }, 400)
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return c.json({ error: 'VALIDATION_ERROR', message: 'Body must be a JSON object' }, 400)
    }

    const { name, status } = body as Record<string, unknown>
    const changes: { name?: string; status?: 'active' | 'suspended' } = {}

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim() === '') {
        return c.json({ error: 'VALIDATION_ERROR', message: '"name" must be a non-empty string' }, 400)
      }
      if (name.length > 255) {
        return c.json({ error: 'VALIDATION_ERROR', message: '"name" must not exceed 255 characters' }, 400)
      }
      changes.name = name.trim()
    }
    if (status !== undefined) {
      if (status !== 'active' && status !== 'suspended') {
        return c.json({ error: 'VALIDATION_ERROR', message: '"status" must be "active" or "suspended"' }, 400)
      }
      changes.status = status
    }
    if (Object.keys(changes).length === 0) {
      return c.json({ error: 'VALIDATION_ERROR', message: 'Provide "name" and/or "status"' }, 400)
    }

    const tenant = await store.updateTenant(id, changes)
    if (!tenant) return c.json({ error: 'NOT_FOUND', message: `Tenant '${id}' not found` }, 404)

    // The status is already stored, so new requests are rejected; now stop the background work.
    if (changes.status === 'suspended') await options.onTenantDeactivating?.(id)

    return c.json({ tenant })
  })

  // ─── DELETE /tenants/:id — destroys the tenant and all of its data ────────

  app.delete('/:id', async (c) => {
    const id = c.req.param('id')

    if (id === PROTECTED_TENANT_ID) {
      return c.json({ error: 'CONFLICT', message: `The '${PROTECTED_TENANT_ID}' tenant cannot be deleted` }, 409)
    }
    if (!(await store.getTenant(id))) {
      return c.json({ error: 'NOT_FOUND', message: `Tenant '${id}' not found` }, 404)
    }

    try {
      // Suspend first: new requests are rejected while the workers are stopped and the data
      // is dropped. If a later step fails the tenant is simply left suspended.
      await store.updateTenant(id, { status: 'suspended' })
      await options.onTenantDeactivating?.(id)
      await dropTenantSchema(id, sql)
      await store.deleteTenantAndKeys(id)
    } catch (err) {
      console.error(`[tenants] failed to delete tenant '${id}':`, err)
      return c.json(
        { error: 'DELETE_FAILED', message: `Failed to delete tenant '${id}'; it has been left suspended` },
        500,
      )
    }

    return c.json({ success: true })
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
