import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type postgres from 'postgres'
import { TenantStore, type Tenant, type ApiKeyPublic } from '../db/TenantStore.js'
import { provisionTenantSchema, dropTenantSchema } from '../db/tenantProvisioner.js'
import { createTenantsRouter } from './tenants.js'

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../db/TenantStore.js', () => ({
  TenantStore: vi.fn(),
}))

vi.mock('../db/tenantProvisioner.js', () => ({
  provisionTenantSchema: vi.fn().mockResolvedValue(undefined),
  dropTenantSchema: vi.fn().mockResolvedValue(undefined),
  VALID_TENANT_ID: /^[a-zA-Z0-9_-]+$/,
  schemaName: (id: string) => `tenant_${id}`,
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: 'tenant-1',
    name: 'Acme Corp',
    status: 'active',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeApiKey(overrides: Partial<ApiKeyPublic> = {}): ApiKeyPublic {
  return {
    id: 'key-id-1',
    tenantId: 'tenant-1',
    name: 'My API Key',
    role: 'service',
    createdBy: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  }
}

// ─── Request helpers ──────────────────────────────────────────────────────────

async function get(app: Hono, path: string, headers?: Record<string, string>): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'GET',
      headers: { ...headers },
    }),
  )
}

async function post(
  app: Hono,
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )
}

async function postRaw(
  app: Hono,
  path: string,
  body: string,
  headers?: Record<string, string>,
): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    }),
  )
}

async function patch(
  app: Hono,
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )
}

async function del(app: Hono, path: string, headers?: Record<string, string>): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'DELETE',
      headers: { ...headers },
    }),
  )
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('tenants HTTP API', () => {
  let mockStore: {
    createTenant: ReturnType<typeof vi.fn>
    getTenant: ReturnType<typeof vi.fn>
    deleteTenant: ReturnType<typeof vi.fn>
    listTenants: ReturnType<typeof vi.fn>
    updateTenant: ReturnType<typeof vi.fn>
    markTenantDeleting: ReturnType<typeof vi.fn>
    deleteTenantAndKeys: ReturnType<typeof vi.fn>
    createApiKey: ReturnType<typeof vi.fn>
    listApiKeys: ReturnType<typeof vi.fn>
    revokeApiKey: ReturnType<typeof vi.fn>
    setApiKeyRole: ReturnType<typeof vi.fn>
  }
  let app: Hono
  let onTenantDeactivating: ReturnType<typeof vi.fn>
  const ADMIN_KEY = 'admin-key'
  const AUTH = { Authorization: `Bearer ${ADMIN_KEY}` }

  beforeEach(() => {
    vi.clearAllMocks()

    mockStore = {
      createTenant: vi.fn(),
      getTenant: vi.fn(),
      deleteTenant: vi.fn().mockResolvedValue(undefined),
      listTenants: vi.fn(),
      updateTenant: vi.fn(),
      markTenantDeleting: vi.fn().mockResolvedValue(true),
      deleteTenantAndKeys: vi.fn().mockResolvedValue(true),
      createApiKey: vi.fn(),
      listApiKeys: vi.fn(),
      revokeApiKey: vi.fn(),
      setApiKeyRole: vi.fn(),
    }

    vi.mocked(TenantStore).mockImplementation(function () {
      return mockStore as unknown as TenantStore
    } as unknown as typeof TenantStore)

    onTenantDeactivating = vi.fn().mockResolvedValue(undefined)
    app = new Hono()
    app.route(
      '/tenants',
      createTenantsRouter(vi.fn() as unknown as postgres.Sql, 'test-secret', ADMIN_KEY, { onTenantDeactivating }),
    )
  })

  // ─── Admin auth ────────────────────────────────────────────────────────────

  describe('admin auth', () => {
    it('should return 403 when no Authorization header is provided on POST /', async () => {
      const res = await post(app, '/tenants', { id: 'tenant-1', name: 'Acme' })
      expect(res.status).toBe(403)
    })

    it('should return 403 when no Authorization header is provided on GET /:id', async () => {
      const res = await get(app, '/tenants/tenant-1')
      expect(res.status).toBe(403)
    })

    it('should return 403 when no Authorization header is provided on POST /:id/keys', async () => {
      const res = await post(app, '/tenants/tenant-1/keys', { name: 'My Key' })
      expect(res.status).toBe(403)
    })

    it('should return 403 when no Authorization header is provided on GET /:id/keys', async () => {
      const res = await get(app, '/tenants/tenant-1/keys')
      expect(res.status).toBe(403)
    })

    it('should return 403 when no Authorization header is provided on DELETE /:id/keys/:keyId', async () => {
      const res = await del(app, '/tenants/tenant-1/keys/key-id-1')
      expect(res.status).toBe(403)
    })

    it('should return 403 when the wrong admin key is provided', async () => {
      const res = await post(app, '/tenants', { id: 'tenant-1', name: 'Acme' }, {
        Authorization: 'Bearer wrong-key',
      })
      expect(res.status).toBe(403)
    })

    it('should return 403 when Authorization scheme is not Bearer', async () => {
      const res = await post(app, '/tenants', { id: 'tenant-1', name: 'Acme' }, {
        Authorization: `Basic ${ADMIN_KEY}`,
      })
      expect(res.status).toBe(403)
    })

    it('should include FORBIDDEN error code in the 403 response', async () => {
      const res = await get(app, '/tenants/tenant-1')
      const body = await res.json() as { error: string }
      expect(body.error).toBe('FORBIDDEN')
    })

    it('should pass through to the handler when the correct admin key is provided', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())

      const res = await get(app, '/tenants/tenant-1', AUTH)

      expect(res.status).toBe(200)
    })
  })

  // ─── POST /tenants ─────────────────────────────────────────────────────────

  describe('POST /tenants', () => {
    it('should return 201 with the created tenant', async () => {
      const tenant = makeTenant()
      vi.mocked(provisionTenantSchema).mockResolvedValueOnce(undefined)
      mockStore.createTenant.mockResolvedValueOnce(tenant)

      const res = await post(app, '/tenants', { id: 'tenant-1', name: 'Acme Corp' }, AUTH)

      expect(res.status).toBe(201)
      const body = await res.json() as { tenant: Tenant }
      expect(body.tenant).toMatchObject({ id: 'tenant-1', name: 'Acme Corp' })
    })

    it('should call provisionTenantSchema after creating the tenant row', async () => {
      const callOrder: string[] = []
      const tenant = makeTenant()

      mockStore.createTenant.mockImplementationOnce(async () => {
        callOrder.push('createTenant')
        return tenant
      })
      vi.mocked(provisionTenantSchema).mockImplementationOnce(async () => {
        callOrder.push('provisionTenantSchema')
      })

      await post(app, '/tenants', { id: 'tenant-1', name: 'Acme Corp' }, AUTH)

      expect(callOrder).toEqual(['createTenant', 'provisionTenantSchema'])
    })

    it('should call createTenant with the provided id and name', async () => {
      const tenant = makeTenant()
      vi.mocked(provisionTenantSchema).mockResolvedValueOnce(undefined)
      mockStore.createTenant.mockResolvedValueOnce(tenant)

      await post(app, '/tenants', { id: 'tenant-1', name: 'Acme Corp' }, AUTH)

      expect(mockStore.createTenant).toHaveBeenCalledWith('tenant-1', 'Acme Corp')
    })

    it('should return 400 when id is missing', async () => {
      const res = await post(app, '/tenants', { name: 'Acme Corp' }, AUTH)

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('should return 400 when id is an empty string', async () => {
      const res = await post(app, '/tenants', { id: '', name: 'Acme Corp' }, AUTH)

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('should return 400 when id is not a string', async () => {
      const res = await post(app, '/tenants', { id: 123, name: 'Acme Corp' }, AUTH)

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('should return 400 when name is missing', async () => {
      const res = await post(app, '/tenants', { id: 'tenant-1' }, AUTH)

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('should return 400 when name is an empty string', async () => {
      const res = await post(app, '/tenants', { id: 'tenant-1', name: '' }, AUTH)

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('should return 400 when name is not a string', async () => {
      const res = await post(app, '/tenants', { id: 'tenant-1', name: 42 }, AUTH)

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('should return 400 when name exceeds 255 characters', async () => {
      const res = await post(app, '/tenants', { id: 'tenant-1', name: 'a'.repeat(256) }, AUTH)

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('should return 400 when body is an array', async () => {
      const res = await app.fetch(
        new Request('http://localhost/tenants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...AUTH },
          body: JSON.stringify([{ id: 'tenant-1', name: 'Acme' }]),
        }),
      )

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('should return 400 when body is non-JSON', async () => {
      const res = await postRaw(app, '/tenants', 'not-valid-json', AUTH)

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('should return 400 when id contains invalid characters (space)', async () => {
      const res = await post(app, '/tenants', { id: 'bad id', name: 'Acme Corp' }, AUTH)

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
      expect(provisionTenantSchema).not.toHaveBeenCalled()
    })

    it('should return 400 when id contains invalid characters (semicolon)', async () => {
      const res = await post(app, '/tenants', { id: 'abc;drop', name: 'Acme Corp' }, AUTH)

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('should return 500 PROVISIONING_FAILED and delete the row when provisionTenantSchema fails', async () => {
      mockStore.createTenant.mockImplementationOnce(async () => makeTenant())
      vi.mocked(provisionTenantSchema).mockImplementationOnce(() => Promise.reject(new Error('DDL failed')))

      const res = await post(app, '/tenants', { id: 'tenant-1', name: 'Acme Corp' }, AUTH)

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('PROVISIONING_FAILED')
      expect(mockStore.deleteTenant).toHaveBeenCalledWith('tenant-1')
    })

    it('should return 500 PROVISIONING_FAILED even when deleteTenant also throws during cleanup', async () => {
      mockStore.createTenant.mockImplementationOnce(async () => makeTenant())
      vi.mocked(provisionTenantSchema).mockImplementationOnce(() => Promise.reject(new Error('DDL failed')))
      mockStore.deleteTenant.mockImplementationOnce(() => Promise.reject(new Error('DB down')))

      const res = await post(app, '/tenants', { id: 'tenant-1', name: 'Acme Corp' }, AUTH)

      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('PROVISIONING_FAILED')
    })

    it('should return 409 when createTenant throws a postgres unique violation (code 23505)', async () => {
      const conflict = Object.assign(new Error('duplicate key value'), { code: '23505' })
      mockStore.createTenant.mockRejectedValueOnce(conflict)

      const res = await post(app, '/tenants', { id: 'tenant-1', name: 'Acme Corp' }, AUTH)

      expect(res.status).toBe(409)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('CONFLICT')
    })

    it('should include the tenant id in the 409 conflict message', async () => {
      const conflict = Object.assign(new Error('duplicate key value'), { code: '23505' })
      mockStore.createTenant.mockRejectedValueOnce(conflict)

      const res = await post(app, '/tenants', { id: 'tenant-1', name: 'Acme Corp' }, AUTH)
      const body = await res.json() as { message: string }

      expect(body.message).toContain('tenant-1')
    })

    it('should rethrow errors from createTenant that are not unique violations', async () => {
      vi.mocked(provisionTenantSchema).mockResolvedValueOnce(undefined)
      mockStore.createTenant.mockRejectedValueOnce(new Error('unexpected DB error'))

      await expect(
        post(app, '/tenants', { id: 'tenant-1', name: 'Acme Corp' }, AUTH),
      ).resolves.toMatchObject({ status: 500 })
    })
  })

  // ─── GET /tenants/:id ──────────────────────────────────────────────────────

  describe('GET /tenants/:id', () => {
    it('should return 200 with the tenant when found', async () => {
      const tenant = makeTenant()
      mockStore.getTenant.mockResolvedValueOnce(tenant)

      const res = await get(app, '/tenants/tenant-1', AUTH)

      expect(res.status).toBe(200)
      const body = await res.json() as { tenant: Tenant }
      expect(body.tenant).toMatchObject({ id: 'tenant-1', name: 'Acme Corp' })
    })

    it('should call getTenant with the correct id from the route param', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())

      await get(app, '/tenants/tenant-1', AUTH)

      expect(mockStore.getTenant).toHaveBeenCalledWith('tenant-1')
    })

    it('should return 404 when the tenant is not found', async () => {
      mockStore.getTenant.mockResolvedValueOnce(null)

      const res = await get(app, '/tenants/unknown-tenant', AUTH)

      expect(res.status).toBe(404)
    })

    it('should include NOT_FOUND error code in the 404 response', async () => {
      mockStore.getTenant.mockResolvedValueOnce(null)

      const res = await get(app, '/tenants/unknown-tenant', AUTH)
      const body = await res.json() as { error: string }

      expect(body.error).toBe('NOT_FOUND')
    })

    it('should include the tenant id in the 404 message', async () => {
      mockStore.getTenant.mockResolvedValueOnce(null)

      const res = await get(app, '/tenants/unknown-tenant', AUTH)
      const body = await res.json() as { message: string }

      expect(body.message).toContain('unknown-tenant')
    })
  })

  // ─── POST /tenants/:id/keys ────────────────────────────────────────────────

  describe('POST /tenants/:id/keys', () => {
    it('should return 201 with the key and plaintext when tenant exists', async () => {
      const tenant = makeTenant()
      const key = makeApiKey()
      const plaintext = 'a'.repeat(64)
      mockStore.getTenant.mockResolvedValueOnce(tenant)
      mockStore.createApiKey.mockResolvedValueOnce({ key, plaintext })

      const res = await post(app, '/tenants/tenant-1/keys', { name: 'My Key' }, AUTH)

      expect(res.status).toBe(201)
      const body = await res.json() as { key: ApiKeyPublic; plaintext: string }
      expect(body.key).toMatchObject({ id: 'key-id-1' })
      expect(body.plaintext).toBe(plaintext)
    })

    it('should include plaintext in the response (only time it is available)', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())
      mockStore.createApiKey.mockResolvedValueOnce({
        key: makeApiKey(),
        plaintext: 'plain-secret-value',
      })

      const res = await post(app, '/tenants/tenant-1/keys', { name: 'Key' }, AUTH)
      const body = await res.json() as { plaintext: string }

      expect(body.plaintext).toBe('plain-secret-value')
    })

    it('should call createApiKey with the tenant id and key name', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())
      mockStore.createApiKey.mockResolvedValueOnce({ key: makeApiKey(), plaintext: 'secret' })

      await post(app, '/tenants/tenant-1/keys', { name: 'Production Key' }, AUTH)

      expect(mockStore.createApiKey).toHaveBeenCalledWith('tenant-1', 'Production Key', { createdBy: null }, undefined) // the admin key: nobody to record
    })

    it('should return 404 when the tenant does not exist', async () => {
      mockStore.getTenant.mockResolvedValueOnce(null)

      const res = await post(app, '/tenants/unknown/keys', { name: 'My Key' }, AUTH)

      expect(res.status).toBe(404)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('NOT_FOUND')
    })

    it('should return 403 when the tenant is suspended', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant({ status: 'suspended' }))

      const res = await post(app, '/tenants/tenant-1/keys', { name: 'My Key' }, AUTH)

      expect(res.status).toBe(403)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('FORBIDDEN')
    })

    it('should not call createApiKey when the tenant is suspended', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant({ status: 'suspended' }))

      await post(app, '/tenants/tenant-1/keys', { name: 'My Key' }, AUTH)

      expect(mockStore.createApiKey).not.toHaveBeenCalled()
    })

    it('should return 400 when name is missing', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())

      const res = await post(app, '/tenants/tenant-1/keys', {}, AUTH)

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('should return 400 when name is an empty string', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())

      const res = await post(app, '/tenants/tenant-1/keys', { name: '' }, AUTH)

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('should return 400 when name is not a string', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())

      const res = await post(app, '/tenants/tenant-1/keys', { name: 123 }, AUTH)

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('should return 400 when name exceeds 255 characters', async () => {
      const res = await post(app, '/tenants/tenant-1/keys', { name: 'a'.repeat(256) }, AUTH)

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('should trim the key name before storing', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())
      mockStore.createApiKey.mockResolvedValueOnce({ key: makeApiKey(), plaintext: 'secret' })

      await post(app, '/tenants/tenant-1/keys', { name: '  Production Key  ' }, AUTH)

      expect(mockStore.createApiKey).toHaveBeenCalledWith('tenant-1', 'Production Key', { createdBy: null }, undefined)
    })

    it('should return 400 when body is non-JSON', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())

      const res = await postRaw(app, '/tenants/tenant-1/keys', 'not-json', AUTH)

      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('should return 403 when tenant is suspended', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant({ status: 'suspended' }))

      const res = await post(app, '/tenants/tenant-1/keys', { name: 'My Key' }, AUTH)

      expect(res.status).toBe(403)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('FORBIDDEN')
    })

    it('should not call createApiKey when tenant is suspended', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant({ status: 'suspended' }))

      await post(app, '/tenants/tenant-1/keys', { name: 'My Key' }, AUTH)

      expect(mockStore.createApiKey).not.toHaveBeenCalled()
    })
  })

  // ─── GET /tenants/:id/keys ─────────────────────────────────────────────────

  describe('GET /tenants/:id/keys', () => {
    it('should return 200 with the keys array when tenant exists', async () => {
      const keys = [makeApiKey({ id: 'k1' }), makeApiKey({ id: 'k2' })]
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())
      mockStore.listApiKeys.mockResolvedValueOnce(keys)

      const res = await get(app, '/tenants/tenant-1/keys', AUTH)

      expect(res.status).toBe(200)
      const body = await res.json() as { keys: ApiKeyPublic[] }
      expect(body.keys).toHaveLength(2)
    })

    it('should return an empty keys array when no keys exist', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())
      mockStore.listApiKeys.mockResolvedValueOnce([])

      const res = await get(app, '/tenants/tenant-1/keys', AUTH)

      expect(res.status).toBe(200)
      const body = await res.json() as { keys: ApiKeyPublic[] }
      expect(body.keys).toEqual([])
    })

    it('should call listApiKeys with the tenant id', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())
      mockStore.listApiKeys.mockResolvedValueOnce([])

      await get(app, '/tenants/tenant-1/keys', AUTH)

      expect(mockStore.listApiKeys).toHaveBeenCalledWith('tenant-1')
    })

    it('should return 404 when tenant does not exist', async () => {
      mockStore.getTenant.mockResolvedValueOnce(null)

      const res = await get(app, '/tenants/unknown/keys', AUTH)

      expect(res.status).toBe(404)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('NOT_FOUND')
    })

    it('should include the tenant id in the 404 message', async () => {
      mockStore.getTenant.mockResolvedValueOnce(null)

      const res = await get(app, '/tenants/unknown/keys', AUTH)
      const body = await res.json() as { message: string }

      expect(body.message).toContain('unknown')
    })

    it('should not call listApiKeys when tenant is not found', async () => {
      mockStore.getTenant.mockResolvedValueOnce(null)

      await get(app, '/tenants/unknown/keys', AUTH)

      expect(mockStore.listApiKeys).not.toHaveBeenCalled()
    })
  })

  // ─── DELETE /tenants/:id/keys/:keyId ──────────────────────────────────────

  describe('key roles', () => {
    const key = (overrides: Partial<ApiKeyPublic> = {}) => makeApiKey({ role: 'service', createdBy: null, ...overrides })
    const patch = (path: string, body: unknown, headers: Record<string, string> = AUTH) =>
      app.fetch(new Request(`http://localhost${path}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }))

    it('creates a key with the role asked for', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())
      mockStore.createApiKey.mockResolvedValueOnce({ key: key({ role: 'tenant_manager' }), plaintext: 'secret' })

      const res = await post(app, '/tenants/tenant-1/keys', { name: 'ERP', role: 'tenant_manager' }, AUTH)

      expect(res.status).toBe(201)
      expect(mockStore.createApiKey).toHaveBeenCalledWith('tenant-1', 'ERP', { role: 'tenant_manager', createdBy: null }, undefined)
    })

    it('leaves the role to the store (least privilege) when none is asked for', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())
      mockStore.createApiKey.mockResolvedValueOnce({ key: key(), plaintext: 'secret' })

      await post(app, '/tenants/tenant-1/keys', { name: 'ci' }, AUTH)

      const options = mockStore.createApiKey.mock.calls[0]![2]
      expect(options).not.toHaveProperty('role')
    })

    it('400 for a role that does not exist', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())

      const res = await post(app, '/tenants/tenant-1/keys', { name: 'ci', role: 'operator' }, AUTH)

      expect(res.status).toBe(400)
      expect(mockStore.createApiKey).not.toHaveBeenCalled()
    })

    it('records the person who created the key', async () => {
      const principal = { kind: 'user', user: { id: 'u-1', email: 'op@example.com' }, memberships: [{ role: 'operator', tenantId: null }] }
      const guarded = new Hono()
      guarded.use('*', async (c, next) => {
        c.set('principal' as never, principal as never)
        return next()
      })
      guarded.route('/tenants', createTenantsRouter(vi.fn() as unknown as postgres.Sql, 'test-secret', ADMIN_KEY, { guard: async (_c, next) => next() }))
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())
      mockStore.createApiKey.mockResolvedValueOnce({ key: key(), plaintext: 'secret' })

      await guarded.fetch(new Request('http://localhost/tenants/tenant-1/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'ci' }) }))

      expect(mockStore.createApiKey).toHaveBeenCalledWith('tenant-1', 'ci', { createdBy: 'u-1' }, undefined)
    })

    describe('who may hand out the tenant_manager role', () => {
      const asUser = (role: 'system_admin' | 'operator') => ({ kind: 'user', user: { id: 'u-1', email: 'p@example.com' }, memberships: [{ role, tenantId: null }] })
      const principals = {
        'a system admin': asUser('system_admin'),
        'an operator': asUser('operator'),
        'an operator key': { kind: 'operatorKey', keyId: 'ok-1', keyName: 'ci' },
        'the admin key': { kind: 'adminKey' },
      } as const
      const appFor = (principal: unknown) => {
        const guarded = new Hono()
        guarded.use('*', async (c, next) => {
          c.set('principal' as never, principal as never)
          return next()
        })
        guarded.route('/tenants', createTenantsRouter(vi.fn() as unknown as postgres.Sql, 'test-secret', ADMIN_KEY, { guard: async (_c, next) => next() }))
        return guarded
      }
      const send = (a: Hono, method: 'POST' | 'PATCH', path: string, body: unknown) =>
        a.fetch(new Request(`http://localhost${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))

      it.each(['an operator', 'an operator key'] as const)('%s cannot create a tenant_manager key (403), nothing is created', async (who) => {
        const res = await send(appFor(principals[who]), 'POST', '/tenants/tenant-1/keys', { name: 'ERP', role: 'tenant_manager' })

        expect(res.status).toBe(403)
        expect(((await res.json()) as { message: string }).message).toMatch(/system admin/i)
        expect(mockStore.createApiKey).not.toHaveBeenCalled()
      })

      it.each(['an operator', 'an operator key'] as const)('%s cannot raise a key to tenant_manager (403)', async (who) => {
        const res = await send(appFor(principals[who]), 'PATCH', '/tenants/tenant-1/keys/key-id-1', { role: 'tenant_manager' })

        expect(res.status).toBe(403)
        expect(mockStore.setApiKeyRole).not.toHaveBeenCalled()
      })

      it.each(['an operator', 'an operator key'] as const)('%s can still create a service key and lower a key to service', async (who) => {
        mockStore.getTenant.mockResolvedValue(makeTenant())
        mockStore.createApiKey.mockResolvedValueOnce({ key: key(), plaintext: 'secret' })
        mockStore.setApiKeyRole.mockResolvedValueOnce({ key: key(), previous: 'tenant_manager' })
        const a = appFor(principals[who])

        expect((await send(a, 'POST', '/tenants/tenant-1/keys', { name: 'ci', role: 'service' })).status).toBe(201)
        expect((await send(a, 'PATCH', '/tenants/tenant-1/keys/key-id-1', { role: 'service' })).status).toBe(200)
      })

      it.each(['a system admin', 'the admin key'] as const)('%s can create a tenant_manager key and raise a key to it', async (who) => {
        mockStore.getTenant.mockResolvedValue(makeTenant())
        mockStore.createApiKey.mockResolvedValueOnce({ key: key({ role: 'tenant_manager' }), plaintext: 'secret' })
        mockStore.setApiKeyRole.mockResolvedValueOnce({ key: key({ role: 'tenant_manager' }), previous: 'service' })
        const a = appFor(principals[who])

        expect((await send(a, 'POST', '/tenants/tenant-1/keys', { name: 'ERP', role: 'tenant_manager' })).status).toBe(201)
        expect((await send(a, 'PATCH', '/tenants/tenant-1/keys/key-id-1', { role: 'tenant_manager' })).status).toBe(200)
      })
    })

    it('changes a key\'s role, keeping its secret, and writes it to the audit log', async () => {
      const recordStrict = vi.fn().mockResolvedValue(undefined)
      app = new Hono()
      app.route('/tenants', createTenantsRouter(vi.fn() as unknown as postgres.Sql, 'test-secret', ADMIN_KEY, { audit: { recordStrict } as never }))
      const changed = { key: key({ role: 'tenant_manager', name: 'ERP' }), previous: 'service' }
      const tx = {}
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())
      // the store runs the entry inside its transaction, as the real one does
      mockStore.setApiKeyRole.mockImplementationOnce(async (_t: string, _k: string, _r: string, within: (tx: unknown, r: unknown) => Promise<void>) => {
        await within(tx, changed)
        return changed
      })

      const res = await patch('/tenants/tenant-1/keys/key-id-1', { role: 'tenant_manager' })

      expect(res.status).toBe(200)
      expect((await res.json()).key.role).toBe('tenant_manager')
      expect(mockStore.setApiKeyRole).toHaveBeenCalledWith('tenant-1', 'key-id-1', 'tenant_manager', expect.any(Function))
      expect(recordStrict).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'key.role', target: 'key-id-1', tenantIds: ['tenant-1'], details: { name: 'ERP', from: 'service', to: 'tenant_manager' } }),
        tx,
      )
    })

    it('writes nothing to the audit log when the role was already that', async () => {
      const recordStrict = vi.fn().mockResolvedValue(undefined)
      app = new Hono()
      app.route('/tenants', createTenantsRouter(vi.fn() as unknown as postgres.Sql, 'test-secret', ADMIN_KEY, { audit: { recordStrict } as never }))
      const unchanged = { key: key({ role: 'service' }), previous: 'service' }
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())
      mockStore.setApiKeyRole.mockImplementationOnce(async (_t: string, _k: string, _r: string, within: (tx: unknown, r: unknown) => Promise<void>) => {
        await within({}, unchanged)
        return unchanged
      })

      const res = await patch('/tenants/tenant-1/keys/key-id-1', { role: 'service' })

      expect(res.status).toBe(200)
      expect(recordStrict).not.toHaveBeenCalled()
    })

    it('500 when the audit entry of a role change cannot be written (the store rolls the change back)', async () => {
      const recordStrict = vi.fn().mockRejectedValue(new Error('audit down'))
      app = new Hono()
      app.route('/tenants', createTenantsRouter(vi.fn() as unknown as postgres.Sql, 'test-secret', ADMIN_KEY, { audit: { recordStrict } as never }))
      const changed = { key: key({ role: 'tenant_manager' }), previous: 'service' }
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())
      mockStore.setApiKeyRole.mockImplementationOnce(async (_t: string, _k: string, _r: string, within: (tx: unknown, r: unknown) => Promise<void>) => {
        await within({}, changed)
        return changed
      })

      const res = await patch('/tenants/tenant-1/keys/key-id-1', { role: 'tenant_manager' })

      expect(res.status).toBe(500)
    })

    it('400 for a missing or unknown role, 404 for an unknown tenant or a revoked key, 403 without the admin key', async () => {
      mockStore.getTenant.mockResolvedValue(makeTenant())
      expect((await patch('/tenants/tenant-1/keys/k', {})).status).toBe(400)
      expect((await patch('/tenants/tenant-1/keys/k', { role: 'god' })).status).toBe(400)

      mockStore.setApiKeyRole.mockResolvedValueOnce(null)
      expect((await patch('/tenants/tenant-1/keys/k', { role: 'service' })).status).toBe(404)

      mockStore.getTenant.mockResolvedValueOnce(null)
      expect((await patch('/tenants/nope/keys/k', { role: 'service' })).status).toBe(404)

      expect((await patch('/tenants/tenant-1/keys/k', { role: 'service' }, {})).status).toBe(403)
    })
  })

  describe('DELETE /tenants/:id/keys/:keyId', () => {
    it('should return 200 with success: true when key is successfully revoked', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())
      mockStore.revokeApiKey.mockResolvedValueOnce(true)

      const res = await del(app, '/tenants/tenant-1/keys/key-id-1', AUTH)

      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean }
      expect(body.success).toBe(true)
    })

    it('should call revokeApiKey with the tenant id and key id', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())
      mockStore.revokeApiKey.mockResolvedValueOnce(true)

      await del(app, '/tenants/tenant-1/keys/key-id-1', AUTH)

      expect(mockStore.revokeApiKey).toHaveBeenCalledWith('tenant-1', 'key-id-1', undefined)
    })

    it('writes the audit entry in the same transaction as the revocation, and not when nothing was revoked', async () => {
      const recordStrict = vi.fn().mockResolvedValue(undefined)
      const audited = new Hono()
      audited.route('/tenants', createTenantsRouter(vi.fn() as unknown as postgres.Sql, 'test-secret', ADMIN_KEY, { audit: { recordStrict } as never }))
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())
      mockStore.revokeApiKey.mockResolvedValueOnce(true)

      await del(audited, '/tenants/tenant-1/keys/key-id-1', AUTH)

      const within = mockStore.revokeApiKey.mock.calls[0]![2] as (tx: unknown) => Promise<void>
      const tx = {}
      await within(tx)
      expect(recordStrict).toHaveBeenCalledWith(expect.objectContaining({ action: 'key.revoke', target: 'key-id-1', tenantIds: ['tenant-1'] }), tx)
    })

    it('500 when the audit entry cannot be written (the store rolls the revocation back)', async () => {
      const recordStrict = vi.fn().mockRejectedValue(new Error('audit down'))
      const audited = new Hono()
      audited.route('/tenants', createTenantsRouter(vi.fn() as unknown as postgres.Sql, 'test-secret', ADMIN_KEY, { audit: { recordStrict } as never }))
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())
      mockStore.revokeApiKey.mockImplementationOnce(async (_t: string, _k: string, within: (tx: unknown, r: boolean) => Promise<void>) => {
        await within({}, true)
        return true
      })

      const res = await del(audited, '/tenants/tenant-1/keys/key-id-1', AUTH)

      expect(res.status).toBe(500)
    })

    it('should return 404 when revokeApiKey returns false (key not found or already revoked)', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())
      mockStore.revokeApiKey.mockResolvedValueOnce(false)

      const res = await del(app, '/tenants/tenant-1/keys/non-existent-key', AUTH)

      expect(res.status).toBe(404)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('NOT_FOUND')
    })

    it('should include the key id in the 404 message when key not found', async () => {
      mockStore.getTenant.mockResolvedValueOnce(makeTenant())
      mockStore.revokeApiKey.mockResolvedValueOnce(false)

      const res = await del(app, '/tenants/tenant-1/keys/missing-key', AUTH)
      const body = await res.json() as { message: string }

      expect(body.message).toContain('missing-key')
    })

    it('should return 404 when tenant does not exist', async () => {
      mockStore.getTenant.mockResolvedValueOnce(null)

      const res = await del(app, '/tenants/unknown/keys/key-id-1', AUTH)

      expect(res.status).toBe(404)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('NOT_FOUND')
    })

    it('should not call revokeApiKey when tenant is not found', async () => {
      mockStore.getTenant.mockResolvedValueOnce(null)

      await del(app, '/tenants/unknown/keys/key-id-1', AUTH)

      expect(mockStore.revokeApiKey).not.toHaveBeenCalled()
    })

    it('should return 403 when no admin key is provided on DELETE', async () => {
      const res = await del(app, '/tenants/tenant-1/keys/key-id-1')

      expect(res.status).toBe(403)
    })
  })
  // ─── GET /tenants ──────────────────────────────────────────────────────────

  describe('GET /tenants', () => {
    it('403 without the admin key', async () => {
      expect((await get(app, '/tenants')).status).toBe(403)
    })

    it('200: lists every tenant with its active key count', async () => {
      mockStore.listTenants.mockResolvedValue([
        { ...makeTenant({ id: 'a' }), activeKeyCount: 2 },
        { ...makeTenant({ id: 'b', status: 'suspended' }), activeKeyCount: 0 },
      ])

      const res = await get(app, '/tenants', AUTH)

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.tenants.map((t: { id: string }) => t.id)).toEqual(['a', 'b'])
      expect(body.tenants[0]).toMatchObject({ status: 'active', activeKeyCount: 2 })
      expect(body.tenants[0]).not.toHaveProperty('counts') // only on request
    })

    describe('?counts=true', () => {
      const COUNTS = { instances: { pending: 0, active: 3, suspended: 1, completed: 9, terminated: 2 }, pendingTasks: 4 }
      let readCounts: ReturnType<typeof vi.fn>

      beforeEach(() => {
        readCounts = vi.fn().mockResolvedValue(COUNTS)
        app = new Hono()
        app.route('/tenants', createTenantsRouter(vi.fn() as unknown as postgres.Sql, 'test-secret', ADMIN_KEY, { onTenantDeactivating, readCounts }))
        mockStore.listTenants.mockResolvedValue([
          { ...makeTenant({ id: 'a' }), activeKeyCount: 1 },
          { ...makeTenant({ id: 'b', status: 'suspended' }), activeKeyCount: 0 },
          { ...makeTenant({ id: 'c', status: 'deleting' }), activeKeyCount: 0 },
        ])
      })

      it('403 without the admin key', async () => {
        expect((await get(app, '/tenants?counts=true')).status).toBe(403)
        expect(readCounts).not.toHaveBeenCalled()
      })

      it('adds the numbers to each tenant, including suspended ones', async () => {
        const body = await (await get(app, '/tenants?counts=true', AUTH)).json()

        expect(body.tenants[0]).toMatchObject({ id: 'a', activeKeyCount: 1, counts: COUNTS })
        expect(body.tenants[1]).toMatchObject({ id: 'b', counts: COUNTS })
      })

      it('does not read a tenant that is being deleted (its schema may be gone)', async () => {
        const body = await (await get(app, '/tenants?counts=true', AUTH)).json()

        expect(body.tenants[2]).toMatchObject({ id: 'c', counts: null })
        expect(readCounts).not.toHaveBeenCalledWith('c')
      })

      it('gives null for a tenant that cannot be read, and still lists the others', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        readCounts.mockImplementation(async (id: string) => {
          if (id === 'a') throw new Error('schema missing')
          return COUNTS
        })

        const res = await get(app, '/tenants?counts=true', AUTH)

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.tenants[0]).toMatchObject({ id: 'a', counts: null })
        expect(body.tenants[1]).toMatchObject({ id: 'b', counts: COUNTS })
        error.mockRestore()
      })

      it('counts at most five tenants at a time, and keeps the order', async () => {
        mockStore.listTenants.mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({ ...makeTenant({ id: `t${i}` }), activeKeyCount: 0 })))
        let running = 0
        let peak = 0
        readCounts.mockImplementation(async () => {
          running++
          peak = Math.max(peak, running)
          await new Promise((resolve) => setTimeout(resolve, 5))
          running--
          return COUNTS
        })

        const body = await (await get(app, '/tenants?counts=true', AUTH)).json()

        expect(peak).toBeLessThanOrEqual(5)
        expect(peak).toBeGreaterThan(1) // it does run them side by side
        expect(body.tenants.map((t: { id: string }) => t.id)).toEqual(Array.from({ length: 12 }, (_, i) => `t${i}`))
        expect(readCounts).toHaveBeenCalledTimes(12)
      })

      it('is off for any other value', async () => {
        const body = await (await get(app, '/tenants?counts=yes', AUTH)).json()

        expect(body.tenants[0]).not.toHaveProperty('counts')
        expect(readCounts).not.toHaveBeenCalled()
      })
    })
  })

  // ─── PATCH /tenants/:id ────────────────────────────────────────────────────

  describe('PATCH /tenants/:id', () => {
    it('403 without the admin key', async () => {
      expect((await patch(app, '/tenants/tenant-1', { status: 'suspended' })).status).toBe(403)
    })

    it('200: suspends a tenant and stops its workers', async () => {
      mockStore.updateTenant.mockResolvedValue(makeTenant({ status: 'suspended' }))

      const res = await patch(app, '/tenants/tenant-1', { status: 'suspended' }, AUTH)

      expect(res.status).toBe(200)
      expect((await res.json()).tenant.status).toBe('suspended')
      expect(mockStore.updateTenant).toHaveBeenCalledWith('tenant-1', { status: 'suspended' })
      expect(onTenantDeactivating).toHaveBeenCalledExactlyOnceWith('tenant-1')
      // The status is stored before workers are stopped, so new requests are already rejected
      expect(mockStore.updateTenant.mock.invocationCallOrder[0]!).toBeLessThan(onTenantDeactivating.mock.invocationCallOrder[0]!)
    })

    it('200: reactivating does not stop anything', async () => {
      mockStore.updateTenant.mockResolvedValue(makeTenant({ status: 'active' }))

      const res = await patch(app, '/tenants/tenant-1', { status: 'active' }, AUTH)

      expect(res.status).toBe(200)
      expect(onTenantDeactivating).not.toHaveBeenCalled()
    })

    it('200: renames a tenant', async () => {
      mockStore.updateTenant.mockResolvedValue(makeTenant({ name: 'New name' }))

      const res = await patch(app, '/tenants/tenant-1', { name: ' New name ' }, AUTH)

      expect(res.status).toBe(200)
      expect(mockStore.updateTenant).toHaveBeenCalledWith('tenant-1', { name: 'New name' })
    })

    it('404 for an unknown tenant', async () => {
      mockStore.updateTenant.mockResolvedValue(null)
      mockStore.getTenant.mockResolvedValue(null)
      const res = await patch(app, '/tenants/nope', { status: 'suspended' }, AUTH)
      expect(res.status).toBe(404)
      expect(onTenantDeactivating).not.toHaveBeenCalled()
    })

    it('409 for a tenant that is being deleted, so a delete cannot be undone halfway', async () => {
      mockStore.updateTenant.mockResolvedValue(null)
      mockStore.getTenant.mockResolvedValue(makeTenant({ status: 'deleting' }))

      const res = await patch(app, '/tenants/tenant-1', { status: 'active' }, AUTH)

      expect(res.status).toBe(409)
      expect(onTenantDeactivating).not.toHaveBeenCalled()
    })

    it('still returns the suspended tenant when stopping its workers fails (the status is already saved)', async () => {
      mockStore.updateTenant.mockResolvedValue(makeTenant({ status: 'suspended' }))
      onTenantDeactivating.mockRejectedValueOnce(new Error('pool end() failed'))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const res = await patch(app, '/tenants/tenant-1', { status: 'suspended' }, AUTH)

      expect(res.status).toBe(200)
      expect((await res.json()).tenant.status).toBe('suspended')
      expect(errorSpy).toHaveBeenCalled()
      errorSpy.mockRestore()
    })

    it.each([
      ['no fields', {}],
      ['an unknown status', { status: 'deleted' }],
      ['an empty name', { name: '   ' }],
      ['a name over 255 characters', { name: 'x'.repeat(256) }],
      ['a non-object body', []],
    ])('400 for %s', async (_label, body) => {
      const res = await patch(app, '/tenants/tenant-1', body, AUTH)
      expect(res.status).toBe(400)
      expect(mockStore.updateTenant).not.toHaveBeenCalled()
    })
  })

  // ─── DELETE /tenants/:id ───────────────────────────────────────────────────

  describe('DELETE /tenants/:id', () => {
    it('403 without the admin key', async () => {
      expect((await del(app, '/tenants/tenant-1')).status).toBe(403)
    })

    it('200: marks the tenant deleting, stops workers, drops the schema, then deletes the rows — in that order', async () => {
      mockStore.getTenant.mockResolvedValue(makeTenant())

      const res = await del(app, '/tenants/tenant-1', AUTH)

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
      const order = [
        mockStore.markTenantDeleting.mock.invocationCallOrder[0]!,
        onTenantDeactivating.mock.invocationCallOrder[0]!,
        vi.mocked(dropTenantSchema).mock.invocationCallOrder[0]!,
        mockStore.deleteTenantAndKeys.mock.invocationCallOrder[0]!,
      ]
      expect(order).toEqual([...order].sort((a, b) => a - b))
      expect(mockStore.markTenantDeleting).toHaveBeenCalledWith('tenant-1')
      expect(dropTenantSchema).toHaveBeenCalledWith('tenant-1', expect.anything())
    })

    it("409: the default tenant cannot be deleted, and nothing is touched", async () => {
      const res = await del(app, '/tenants/default', AUTH)

      expect(res.status).toBe(409)
      expect(mockStore.markTenantDeleting).not.toHaveBeenCalled()
      expect(dropTenantSchema).not.toHaveBeenCalled()
    })

    it('writes the intent to the audit log before anything is touched, and refuses to start when it cannot', async () => {
      const recordStrict = vi.fn().mockRejectedValue(new Error('audit down'))
      const audited = new Hono()
      audited.route('/tenants', createTenantsRouter(vi.fn() as unknown as postgres.Sql, 'test-secret', ADMIN_KEY, { audit: { recordStrict } as never }))
      mockStore.getTenant.mockResolvedValue(makeTenant())

      const res = await del(audited, '/tenants/tenant-1', AUTH)

      expect(res.status).toBe(500)
      expect(recordStrict).toHaveBeenCalledWith(expect.objectContaining({ action: 'tenant.delete.requested', target: 'tenant-1', tenantIds: ['tenant-1'] }))
      expect(mockStore.markTenantDeleting).not.toHaveBeenCalled()
      expect(dropTenantSchema).not.toHaveBeenCalled()
      expect(mockStore.deleteTenantAndKeys).not.toHaveBeenCalled()
    })

    it('can be retried: deleting a tenant that is already "deleting" runs the delete again', async () => {
      mockStore.getTenant.mockResolvedValue(makeTenant({ status: 'deleting' }))

      const res = await del(app, '/tenants/tenant-1', AUTH)

      expect(res.status).toBe(200)
      expect(dropTenantSchema).toHaveBeenCalled()
      expect(mockStore.deleteTenantAndKeys).toHaveBeenCalled()
    })

    it('404 for an unknown tenant', async () => {
      mockStore.getTenant.mockResolvedValue(null)
      const res = await del(app, '/tenants/nope', AUTH)
      expect(res.status).toBe(404)
      expect(dropTenantSchema).not.toHaveBeenCalled()
    })

    it('500 and leaves the tenant in "deleting", with its rows intact, when the schema cannot be dropped', async () => {
      mockStore.getTenant.mockResolvedValue(makeTenant())
      vi.mocked(dropTenantSchema).mockRejectedValueOnce(new Error('lock timeout'))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const res = await del(app, '/tenants/tenant-1', AUTH)

      expect(res.status).toBe(500)
      expect((await res.json()).error).toBe('DELETE_FAILED')
      expect(mockStore.deleteTenantAndKeys).not.toHaveBeenCalled()
      errorSpy.mockRestore()
    })
  })
})
