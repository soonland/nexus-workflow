import { createHmac } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from './migrate.js'
import { dropTenantSchema } from './tenantProvisioner.js'
import { provisionTenantWithKey } from './provisionTenant.js'

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'
const HMAC_SECRET = 'provision-test-secret'

describe('provisionTenantWithKey', () => {
  const createdTenants: string[] = []
  let sql: postgres.Sql

  beforeAll(async () => {
    await runMigrations(DATABASE_URL)
    sql = postgres(DATABASE_URL)
  })

  afterAll(async () => {
    for (const id of createdTenants) {
      await dropTenantSchema(id, sql)
      await sql`DELETE FROM public.api_keys WHERE tenant_id = ${id}`
      await sql`DELETE FROM public.tenants WHERE id = ${id}`
    }
    await sql.end()
  })

  const newTenantId = () => {
    const id = `prov_${crypto.randomUUID().slice(0, 8)}`
    createdTenants.push(id)
    return id
  }

  it('creates the tenant, its schema and an API key that authenticates as that tenant', async () => {
    const tenantId = newTenantId()

    const result = await provisionTenantWithKey(sql, HMAC_SECRET, { tenantId, name: 'Provision test' })

    expect(result.tenantCreated).toBe(true)
    const [tenant] = await sql`SELECT id, name, status FROM public.tenants WHERE id = ${tenantId}`
    expect(tenant).toMatchObject({ id: tenantId, name: 'Provision test', status: 'active' })

    const [schema] = await sql`SELECT 1 AS ok FROM pg_namespace WHERE nspname = ${'tenant_' + tenantId}`
    expect(schema).toBeDefined()

    // The same lookup the auth middleware performs
    const keyHash = createHmac('sha256', HMAC_SECRET).update(result.plaintextKey).digest('hex')
    const [key] = await sql`SELECT tenant_id FROM public.api_keys WHERE key_hash = ${keyHash} AND revoked_at IS NULL`
    expect(key?.['tenant_id']).toBe(tenantId)
  })

  it('is safe to run again: keeps the tenant and issues a new key', async () => {
    const tenantId = newTenantId()
    const first = await provisionTenantWithKey(sql, HMAC_SECRET, { tenantId, name: 'Again' })

    const second = await provisionTenantWithKey(sql, HMAC_SECRET, { tenantId, name: 'Again' })

    expect(second.tenantCreated).toBe(false)
    expect(second.plaintextKey).not.toBe(first.plaintextKey)
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM public.api_keys WHERE tenant_id = ${tenantId}`
    expect(n).toBe(2)
  })

  it('rejects an invalid tenant id without creating anything', async () => {
    await expect(
      provisionTenantWithKey(sql, HMAC_SECRET, { tenantId: 'bad tenant!', name: 'x' }),
    ).rejects.toThrow(/Invalid tenantId/)
    const rows = await sql`SELECT 1 FROM public.tenants WHERE id = 'bad tenant!'`
    expect(rows).toHaveLength(0)
  })

  it('uses the tenant id as the name when no name is given', async () => {
    const tenantId = newTenantId()
    await provisionTenantWithKey(sql, HMAC_SECRET, { tenantId })
    const [tenant] = await sql`SELECT name FROM public.tenants WHERE id = ${tenantId}`
    expect(tenant?.['name']).toBe(tenantId)
  })
})
