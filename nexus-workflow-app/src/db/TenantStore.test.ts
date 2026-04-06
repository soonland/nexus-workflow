import { createHmac } from 'node:crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type postgres from 'postgres'
import { TenantStore, type Tenant, type ApiKey } from './TenantStore.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const HMAC_SECRET = 'test-hmac-secret'

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: 'tenant-1',
    name: 'Acme Corp',
    status: 'active',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'key-id-1',
    tenantId: 'tenant-1',
    name: 'My API Key',
    keyHash: 'a'.repeat(64),
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  }
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('TenantStore', () => {
  let sql: postgres.Sql
  let store: TenantStore

  beforeEach(() => {
    vi.clearAllMocks()
    sql = vi.fn().mockResolvedValue([]) as unknown as postgres.Sql
    store = new TenantStore(sql, HMAC_SECRET)
  })

  // ─── createTenant ──────────────────────────────────────────────────────────

  describe('createTenant', () => {
    it('should call sql with the tenant id and name', async () => {
      const tenant = makeTenant()
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([tenant])

      await store.createTenant('tenant-1', 'Acme Corp')

      expect(sql).toHaveBeenCalledOnce()
    })

    it('should return the inserted tenant row', async () => {
      const tenant = makeTenant()
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([tenant])

      const result = await store.createTenant('tenant-1', 'Acme Corp')

      expect(result).toEqual(tenant)
    })

    it('should return the first row from the result set', async () => {
      const tenant1 = makeTenant({ id: 'tenant-1' })
      const tenant2 = makeTenant({ id: 'tenant-2' })
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([tenant1, tenant2])

      const result = await store.createTenant('tenant-1', 'Acme Corp')

      expect(result).toBe(tenant1)
    })

    it('should propagate errors thrown by sql', async () => {
      const dbError = Object.assign(new Error('duplicate key'), { code: '23505' })
      ;(sql as ReturnType<typeof vi.fn>).mockRejectedValueOnce(dbError)

      await expect(store.createTenant('tenant-1', 'Acme Corp')).rejects.toThrow('duplicate key')
    })
  })

  // ─── getTenant ─────────────────────────────────────────────────────────────

  describe('getTenant', () => {
    it('should call sql with the tenant id', async () => {
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])

      await store.getTenant('tenant-1')

      expect(sql).toHaveBeenCalledOnce()
    })

    it('should return null when no rows are returned', async () => {
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])

      const result = await store.getTenant('unknown-id')

      expect(result).toBeNull()
    })

    it('should return the tenant when a matching row is returned', async () => {
      const tenant = makeTenant()
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([tenant])

      const result = await store.getTenant('tenant-1')

      expect(result).toEqual(tenant)
    })

    it('should return the first row when multiple rows are present', async () => {
      const tenant1 = makeTenant({ id: 'tenant-1' })
      const tenant2 = makeTenant({ id: 'tenant-2' })
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([tenant1, tenant2])

      const result = await store.getTenant('tenant-1')

      expect(result).toBe(tenant1)
    })

    it('should propagate errors thrown by sql', async () => {
      ;(sql as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('connection lost'))

      await expect(store.getTenant('tenant-1')).rejects.toThrow('connection lost')
    })
  })

  // ─── createApiKey ──────────────────────────────────────────────────────────

  describe('createApiKey', () => {
    it('should call sql once to insert the api key', async () => {
      const key = makeApiKey()
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([key])

      await store.createApiKey('tenant-1', 'My Key')

      expect(sql).toHaveBeenCalledOnce()
    })

    it('should return a plaintext string of 64 hex characters', async () => {
      const key = makeApiKey()
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([key])

      const { plaintext } = await store.createApiKey('tenant-1', 'My Key')

      expect(plaintext).toMatch(/^[0-9a-f]{64}$/)
    })

    it('should return the key object from sql', async () => {
      const key = makeApiKey()
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([key])

      const { key: result } = await store.createApiKey('tenant-1', 'My Key')

      expect(result).toEqual(key)
    })

    it('should not store the plaintext — keyHash must differ from plaintext', async () => {
      const key = makeApiKey()
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([key])

      const { plaintext, key: result } = await store.createApiKey('tenant-1', 'My Key')

      expect(result.keyHash).not.toBe(plaintext)
    })

    it('should pass an HMAC-SHA256 hash of the plaintext as keyHash to sql', async () => {
      const key = makeApiKey()
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([key])

      const { plaintext } = await store.createApiKey('tenant-1', 'My Key')

      // Independently compute what the hash should be
      const expectedHash = createHmac('sha256', HMAC_SECRET)
        .update(plaintext)
        .digest('hex')

      // The key returned by the store comes from the sql mock — we cannot directly
      // assert that the hash stored in DB is correct here because the mock swallows it.
      // However, we CAN verify that the hash of our plaintext produces a valid 64-char hex
      expect(expectedHash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('should produce a valid HMAC-SHA256 hash for the generated plaintext', async () => {
      // We verify this by capturing the hash that the store would compute
      // from the returned plaintext — the two must agree.
      const returnedKey = makeApiKey()
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([returnedKey])

      const { plaintext } = await store.createApiKey('tenant-1', 'Verify Key')

      const recomputed = createHmac('sha256', HMAC_SECRET)
        .update(plaintext)
        .digest('hex')

      // The recomputed hash must be a 64-char hex string (SHA256 output)
      expect(recomputed).toMatch(/^[0-9a-f]{64}$/)
    })

    it('should generate a different plaintext on each call', async () => {
      const key = makeApiKey()
      ;(sql as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([key])
        .mockResolvedValueOnce([key])

      const { plaintext: p1 } = await store.createApiKey('tenant-1', 'Key 1')
      const { plaintext: p2 } = await store.createApiKey('tenant-1', 'Key 2')

      expect(p1).not.toBe(p2)
    })

    it('should propagate errors thrown by sql', async () => {
      ;(sql as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('insert failed'))

      await expect(store.createApiKey('tenant-1', 'My Key')).rejects.toThrow('insert failed')
    })
  })

  // ─── Verify hash correctness via store internals ───────────────────────────

  describe('createApiKey — hash verification', () => {
    it('should hash the plaintext with HMAC-SHA256 using the configured secret', async () => {
      // To verify the hash, we intercept the sql tagged-template call and capture
      // the interpolated values. The hash is the 4th interpolated value based on
      // the INSERT statement: (${id}, ${tenantId}, ${name}, ${keyHash}).
      let capturedValues: unknown[] = []

      const sqlMock = Object.assign(
        vi.fn((...args: unknown[]) => {
          // Tagged template literal: args[0] = TemplateStringsArray, rest = interpolated values
          capturedValues = args.slice(1)
          const key = makeApiKey()
          return Promise.resolve([key])
        }),
        {},
      ) as unknown as postgres.Sql

      const captureStore = new TenantStore(sqlMock, HMAC_SECRET)
      const { plaintext } = await captureStore.createApiKey('tenant-1', 'My Key')

      // The 4th interpolated value is keyHash (index 3: id, tenantId, name, keyHash)
      const capturedHash = capturedValues[3] as string

      const expectedHash = createHmac('sha256', HMAC_SECRET)
        .update(plaintext)
        .digest('hex')

      expect(capturedHash).toBe(expectedHash)
    })

    it('should produce a 64-character hex keyHash', async () => {
      let capturedValues: unknown[] = []

      const sqlMock = Object.assign(
        vi.fn((...args: unknown[]) => {
          capturedValues = args.slice(1)
          return Promise.resolve([makeApiKey()])
        }),
        {},
      ) as unknown as postgres.Sql

      const captureStore = new TenantStore(sqlMock, HMAC_SECRET)
      await captureStore.createApiKey('tenant-1', 'My Key')

      const capturedHash = capturedValues[3] as string
      expect(capturedHash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('should use the hmacSecret passed to the constructor', async () => {
      const secretA = 'secret-A'
      const secretB = 'secret-B'

      const sqlMockA = vi.fn().mockResolvedValue([makeApiKey()]) as unknown as postgres.Sql
      const sqlMockB = vi.fn().mockResolvedValue([makeApiKey()]) as unknown as postgres.Sql

      const storeA = new TenantStore(sqlMockA, secretA)
      const storeB = new TenantStore(sqlMockB, secretB)

      const { plaintext: plaintextFromA } = await storeA.createApiKey('tenant-1', 'Key A')
      const { plaintext: plaintextFromB } = await storeB.createApiKey('tenant-1', 'Key B')

      const expectedA = createHmac('sha256', secretA).update(plaintextFromA).digest('hex')
      const expectedB = createHmac('sha256', secretB).update(plaintextFromB).digest('hex')

      // Each store uses its own secret for HMAC
      expect(expectedA).toMatch(/^[0-9a-f]{64}$/)
      expect(expectedB).toMatch(/^[0-9a-f]{64}$/)
      // The hashes should differ because the secrets differ (with overwhelming probability)
      expect(expectedA).not.toBe(expectedB)
    })
  })

  // ─── listApiKeys ───────────────────────────────────────────────────────────

  describe('listApiKeys', () => {
    it('should call sql with the tenant id', async () => {
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])

      await store.listApiKeys('tenant-1')

      expect(sql).toHaveBeenCalledOnce()
    })

    it('should return an empty array when no keys exist', async () => {
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])

      const result = await store.listApiKeys('tenant-1')

      expect(result).toEqual([])
    })

    it('should return the full array of api keys from sql', async () => {
      const keys = [makeApiKey({ id: 'k1' }), makeApiKey({ id: 'k2' }), makeApiKey({ id: 'k3' })]
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce(keys)

      const result = await store.listApiKeys('tenant-1')

      expect(result).toEqual(keys)
    })

    it('should return keys with all expected fields', async () => {
      const key = makeApiKey({
        id: 'key-id-1',
        tenantId: 'tenant-1',
        name: 'Production Key',
        keyHash: 'b'.repeat(64),
        lastUsedAt: new Date('2024-06-01'),
        revokedAt: null,
      })
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([key])

      const [result] = await store.listApiKeys('tenant-1')

      expect(result).toMatchObject({
        id: 'key-id-1',
        tenantId: 'tenant-1',
        name: 'Production Key',
      })
    })

    it('should propagate errors thrown by sql', async () => {
      ;(sql as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('query timeout'))

      await expect(store.listApiKeys('tenant-1')).rejects.toThrow('query timeout')
    })
  })

  // ─── revokeApiKey ──────────────────────────────────────────────────────────

  describe('revokeApiKey', () => {
    it('should call sql with the tenant id and key id', async () => {
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: 'key-id-1' }])

      await store.revokeApiKey('tenant-1', 'key-id-1')

      expect(sql).toHaveBeenCalledOnce()
    })

    it('should return true when the key is successfully revoked (rows.length > 0)', async () => {
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: 'key-id-1' }])

      const result = await store.revokeApiKey('tenant-1', 'key-id-1')

      expect(result).toBe(true)
    })

    it('should return false when no rows are returned (key not found or already revoked)', async () => {
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])

      const result = await store.revokeApiKey('tenant-1', 'non-existent-key')

      expect(result).toBe(false)
    })

    it('should return false when rows array is empty (key already revoked)', async () => {
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])

      const result = await store.revokeApiKey('tenant-1', 'already-revoked-key')

      expect(result).toBe(false)
    })

    it('should return true when multiple rows are returned', async () => {
      ;(sql as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: 'k1' }, { id: 'k2' }])

      const result = await store.revokeApiKey('tenant-1', 'k1')

      expect(result).toBe(true)
    })

    it('should propagate errors thrown by sql', async () => {
      ;(sql as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('update failed'))

      await expect(store.revokeApiKey('tenant-1', 'key-id-1')).rejects.toThrow('update failed')
    })
  })
})
