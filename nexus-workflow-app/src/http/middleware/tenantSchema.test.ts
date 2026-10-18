import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { TenantSchemaHealth } from '../../db/tenantMigrations.js'
import { createTenantSchemaGuard } from './tenantSchema.js'
import type { AppVariables } from './auth.js'

describe('tenant schema guard', () => {
  const health = new TenantSchemaHealth()
  health.markBehind('stale', 'boom')
  const app = new Hono<{ Variables: AppVariables }>()
  app.use('*', async (c, next) => {
    c.set('tenantId', c.req.header('x-test-tenant') ?? '')
    return next()
  })
  app.use('*', createTenantSchemaGuard(health))
  app.get('/', (c) => c.json({ ok: true }))

  it('refuses a tenant that is behind with 503', async () => {
    const res = await app.request('/', { headers: { 'x-test-tenant': 'stale' } })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { error: string }).error).toBe('TENANT_SCHEMA_OUTDATED')
  })

  it('serves other tenants', async () => {
    const res = await app.request('/', { headers: { 'x-test-tenant': 'fine' } })
    expect(res.status).toBe(200)
  })
})
