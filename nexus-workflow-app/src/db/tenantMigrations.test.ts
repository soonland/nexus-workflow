import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from './migrate.js'
import {
  migrateAllTenants,
  migrateTenantSchema,
  TENANT_MIGRATIONS,
  TenantSchemaHealth,
  type TenantMigration,
} from './tenantMigrations.js'
import { dropTenantSchema, provisionTenantSchema } from './tenantProvisioner.js'

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'

describe('tenant migrations', () => {
  const prefix = `tm_${crypto.randomUUID().slice(0, 6)}`
  const ids = { a: `${prefix}_a`, b: `${prefix}_b`, old: `${prefix}_old` }
  let sql: postgres.Sql

  const addColumn: TenantMigration = {
    version: '002_test_column',
    run: async (tx) => {
      await tx.unsafe('ALTER TABLE definitions ADD COLUMN IF NOT EXISTS test_note TEXT')
    },
  }
  const failing: TenantMigration = {
    version: '002_test_column',
    run: async (tx, schema) => {
      // Fails only for tenant b
      if (schema.endsWith('_b')) throw new Error('boom')
      await tx.unsafe('ALTER TABLE definitions ADD COLUMN IF NOT EXISTS test_note TEXT')
    },
  }
  const columns = async (tenantId: string) =>
    (await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = ${'tenant_' + tenantId} AND table_name = 'definitions'
    `).map(r => r['column_name'] as string)

  beforeAll(async () => {
    await runMigrations(DATABASE_URL)
    sql = postgres(DATABASE_URL)
    for (const id of Object.values(ids)) await sql`INSERT INTO public.tenants (id, name) VALUES (${id}, ${id})`
  })

  afterAll(async () => {
    for (const id of Object.values(ids)) {
      await dropTenantSchema(id, sql)
      await sql`DELETE FROM public.tenants WHERE id = ${id}`
    }
    await sql.end()
  })

  it('provisioning applies and records every migration', async () => {
    await provisionTenantSchema(ids.a, sql)
    await provisionTenantSchema(ids.b, sql)
    const rows = await sql`SELECT version FROM ${sql('tenant_' + ids.a)}.schema_migrations ORDER BY version`
    expect(rows.map(r => r['version'])).toEqual(TENANT_MIGRATIONS.map(m => m.version))
  })

  it('is idempotent: a second run applies nothing', async () => {
    expect(await migrateTenantSchema(sql, `tenant_${ids.a}`)).toEqual([])
  })

  it('adopts a schema created before tracking existed (baseline is re-run harmlessly)', async () => {
    const { createTenantSchema } = await import('./schema.js')
    await createTenantSchema(sql, `tenant_${ids.old}`)
    const applied = await migrateTenantSchema(sql, `tenant_${ids.old}`)
    expect(applied).toEqual(['001_baseline'])
  })

  it('rejects an unsafe schema name', async () => {
    await expect(migrateTenantSchema(sql, 'tenant_x"; DROP SCHEMA public; --')).rejects.toThrow('Invalid tenant schema name')
  })

  it('brings every tenant up to date with a new migration', async () => {
    const migrations = [...TENANT_MIGRATIONS, addColumn]
    const health = new TenantSchemaHealth()
    const result = await migrateAllTenants(sql, { migrations, health })
    for (const id of Object.values(ids)) {
      expect(result.upToDate).toContain(id)
      expect(await columns(id)).toContain('test_note')
    }
    expect(result.failed.filter(f => f.tenantId.startsWith(prefix))).toEqual([])
  })

  it('a failing tenant is reported and does not block the others; its failed migration is rolled back', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // Drop the column everywhere so the "new" migration really is pending again
      for (const id of Object.values(ids)) {
        await sql.unsafe(`ALTER TABLE "tenant_${id}".definitions DROP COLUMN test_note`)
        await sql`DELETE FROM ${sql('tenant_' + id)}.schema_migrations WHERE version = '002_test_column'`
      }
      const health = new TenantSchemaHealth()
      const result = await migrateAllTenants(sql, { migrations: [...TENANT_MIGRATIONS, failing], health })

      expect(result.failed.map(f => f.tenantId)).toEqual([ids.b])
      expect(result.failed[0]?.error).toContain('002_test_column')
      expect(result.failed[0]?.error).toContain('boom')
      expect(health.isBehind(ids.b)).toBe(true)
      expect(health.isBehind(ids.a)).toBe(false)
      expect(result.upToDate).toContain(ids.a)
      expect(result.upToDate).toContain(ids.old)
      expect(await columns(ids.a)).toContain('test_note')
      expect(await columns(ids.b)).not.toContain('test_note')

      // Once the migration is fixed, the next run recovers the tenant
      const retry = await migrateAllTenants(sql, { migrations: [...TENANT_MIGRATIONS, addColumn], health })
      expect(retry.failed.filter(f => f.tenantId.startsWith(prefix))).toEqual([])
      expect(health.isBehind(ids.b)).toBe(false)
      expect(await columns(ids.b)).toContain('test_note')
    } finally {
      error.mockRestore()
    }
  })

  it('skips tenants being deleted', async () => {
    await sql`UPDATE public.tenants SET status = 'deleting' WHERE id = ${ids.old}`
    const result = await migrateAllTenants(sql)
    expect(result.upToDate).not.toContain(ids.old)
    await sql`UPDATE public.tenants SET status = 'active' WHERE id = ${ids.old}`
  })

  it('startup migration skips a tenant with no schema; provisioning creates and migrates it', async () => {
    const id = `${prefix}_new`
    await sql`INSERT INTO public.tenants (id, name) VALUES (${id}, ${id})`
    try {
      const schemaExists = async () =>
        (await sql`SELECT 1 FROM pg_namespace WHERE nspname = ${'tenant_' + id}`).length > 0
      const result = await migrateAllTenants(sql)
      expect(result.upToDate).not.toContain(id)
      expect(result.failed.map(f => f.tenantId)).not.toContain(id)
      expect(await schemaExists()).toBe(false)

      await provisionTenantSchema(id, sql)
      expect(await schemaExists()).toBe(true)
      const rows = await sql`SELECT version FROM ${sql('tenant_' + id)}.schema_migrations`
      expect(rows.map(r => r['version'])).toEqual(TENANT_MIGRATIONS.map(m => m.version))
    } finally {
      await dropTenantSchema(id, sql)
      await sql`DELETE FROM public.tenants WHERE id = ${id}`
    }
  })

  it('serializes concurrent runners', async () => {
    const id = `${prefix}_conc`
    await sql`INSERT INTO public.tenants (id, name) VALUES (${id}, ${id})`
    try {
      const runs = await Promise.all([1, 2, 3].map(() => migrateTenantSchema(sql, `tenant_${id}`)))
      expect(runs.flat()).toEqual(TENANT_MIGRATIONS.map(m => m.version))
    } finally {
      await dropTenantSchema(id, sql)
      await sql`DELETE FROM public.tenants WHERE id = ${id}`
    }
  })
})
