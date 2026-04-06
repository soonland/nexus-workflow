import { describe, it, expect, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import type postgres from 'postgres'
import { createAuthMiddleware, type AppVariables } from './auth.js'

// ---------------------------------------------------------------------------
// Helper: create a tagged-template sql mock that resolves with `rows` for
// each call in order.  The mock must behave as a tagged-template function
// because the middleware calls it as: sql`SELECT ...` and sql`UPDATE ...`
// ---------------------------------------------------------------------------
function makeSqlMock(...rowSets: Record<string, unknown>[][]): postgres.Sql {
  const fn = vi.fn()
  for (const rows of rowSets) {
    fn.mockResolvedValueOnce(rows)
  }
  // Fall back to an empty result for any unexpected call
  fn.mockResolvedValue([])
  return fn as unknown as postgres.Sql
}

// ---------------------------------------------------------------------------
// Helper: build a minimal Hono app with the auth middleware mounted globally,
// a /health route, and a /protected route that echoes the resolved tenantId.
// ---------------------------------------------------------------------------
function buildApp(sql: postgres.Sql) {
  const app = new Hono<{ Variables: AppVariables }>()
  app.use('*', createAuthMiddleware(sql))
  app.get('/health', c => c.json({ status: 'ok' }))
  app.get('/protected', c => c.json({ tenantId: c.get('tenantId') }))
  return app
}

// ---------------------------------------------------------------------------
// Convenience: fire a request against the app
// ---------------------------------------------------------------------------
function request(
  app: Hono<{ Variables: AppVariables }>,
  path: string,
  headers?: Record<string, string>,
): Promise<Response> {
  return app.fetch(new Request(`http://localhost${path}`, { headers }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ===========================================================================
describe('createAuthMiddleware', () => {
  // -------------------------------------------------------------------------
  describe('GET /health bypass', () => {
    it('should return 200 without any Authorization header', async () => {
      const sql = makeSqlMock()
      const app = buildApp(sql)

      const res = await request(app, '/health')

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ status: 'ok' })
    })

    it('should never call sql for the health path', async () => {
      const sql = makeSqlMock()
      const app = buildApp(sql)

      await request(app, '/health')

      expect(sql).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  describe('missing or malformed Authorization header', () => {
    it('should return 401 with WWW-Authenticate when Authorization header is absent', async () => {
      const sql = makeSqlMock()
      const app = buildApp(sql)

      const res = await request(app, '/protected')

      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="nexus-workflow"')
    })

    it('should return 401 when scheme is Basic instead of Bearer', async () => {
      const sql = makeSqlMock()
      const app = buildApp(sql)

      const res = await request(app, '/protected', { Authorization: 'Basic c29tZWtleQ==' })

      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="nexus-workflow"')
    })

    it('should return 401 when Bearer token is missing (header is just "Bearer")', async () => {
      const sql = makeSqlMock()
      const app = buildApp(sql)

      const res = await request(app, '/protected', { Authorization: 'Bearer' })

      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="nexus-workflow"')
    })

    it('should not call sql when the Authorization header is absent', async () => {
      const sql = makeSqlMock()
      const app = buildApp(sql)

      await request(app, '/protected')

      expect(sql).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  describe('unknown key (no matching row in db)', () => {
    it('should return 401 when sql returns an empty array', async () => {
      // SELECT returns no rows
      const sql = makeSqlMock([])
      const app = buildApp(sql)

      const res = await request(app, '/protected', {
        Authorization: 'Bearer unknown-api-key',
      })

      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="nexus-workflow"')
    })
  })

  // -------------------------------------------------------------------------
  describe('revoked key', () => {
    it('should return 401 when the matching row has a non-null revoked_at', async () => {
      const sql = makeSqlMock([{ tenant_id: 'tenant-1', revoked_at: new Date() }])
      const app = buildApp(sql)

      const res = await request(app, '/protected', {
        Authorization: 'Bearer revoked-api-key',
      })

      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="nexus-workflow"')
    })
  })

  // -------------------------------------------------------------------------
  describe('valid key', () => {
    it('should return 200 and forward the request to the route handler', async () => {
      const sql = makeSqlMock(
        [{ tenant_id: 'tenant-1', revoked_at: null }], // SELECT
        [], // UPDATE (fire-and-forget)
      )
      const app = buildApp(sql)

      const res = await request(app, '/protected', {
        Authorization: 'Bearer valid-api-key',
      })

      expect(res.status).toBe(200)
    })

    it('should set tenantId on the Hono context so route handlers can read it', async () => {
      const sql = makeSqlMock(
        [{ tenant_id: 'tenant-abc', revoked_at: null }],
        [],
      )
      const app = buildApp(sql)

      const res = await request(app, '/protected', {
        Authorization: 'Bearer valid-api-key',
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ tenantId: 'tenant-abc' })
    })

    it('should call sql twice — once for SELECT and once for the fire-and-forget UPDATE', async () => {
      const sql = makeSqlMock(
        [{ tenant_id: 'tenant-1', revoked_at: null }],
        [],
      )
      const app = buildApp(sql)

      // Wait long enough for the fire-and-forget UPDATE microtask to settle
      const res = await request(app, '/protected', {
        Authorization: 'Bearer valid-api-key',
      })
      // Drain the microtask queue so the fire-and-forget call is recorded
      await Promise.resolve()

      expect(res.status).toBe(200)
      expect(sql).toHaveBeenCalledTimes(2)
    })

    it('should still return 200 when the fire-and-forget UPDATE rejects', async () => {
      const fn = vi.fn()
      // First call (SELECT) resolves with a valid row
      fn.mockResolvedValueOnce([{ tenant_id: 'tenant-1', revoked_at: null }])
      // Second call (UPDATE fire-and-forget) rejects — must be swallowed
      fn.mockRejectedValueOnce(new Error('db connection lost'))
      const sql = fn as unknown as postgres.Sql

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

      const app = buildApp(sql)

      const res = await request(app, '/protected', {
        Authorization: 'Bearer valid-api-key',
      })
      // Drain the microtask queue so the rejection handler runs
      await Promise.resolve()

      expect(res.status).toBe(200)
      // The error is swallowed with a console.warn — verify it was called
      expect(warnSpy).toHaveBeenCalledWith(
        '[auth] failed to update last_used_at:',
        expect.any(Error),
      )
    })
  })
})
