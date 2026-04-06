import { describe, it, expect, vi, beforeEach } from 'vitest'
import type postgres from 'postgres'
import { createTenantSchema } from './schema.js'

function makeSqlMock() {
  const unsafe = vi.fn().mockResolvedValue([])
  return { unsafe } as unknown as postgres.Sql
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── createTenantSchema ───────────────────────────────────────────────────────

describe('createTenantSchema', () => {
  it('should call sql.unsafe exactly once', async () => {
    const sql = makeSqlMock()
    await createTenantSchema(sql, 'myschema')
    expect(sql.unsafe).toHaveBeenCalledOnce()
  })

  it('should pass a single string argument to sql.unsafe', async () => {
    const sql = makeSqlMock()
    await createTenantSchema(sql, 'myschema')
    const calls = (sql.unsafe as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0]).toHaveLength(1)
    expect(typeof calls[0]![0]).toBe('string')
  })

  it('should resolve without a value on success', async () => {
    const sql = makeSqlMock()
    await expect(createTenantSchema(sql, 'myschema')).resolves.toBeUndefined()
  })

  it('should include CREATE SCHEMA IF NOT EXISTS "myschema" in the DDL', async () => {
    const sql = makeSqlMock()
    await createTenantSchema(sql, 'myschema')
    const [ddl] = (sql.unsafe as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(ddl).toContain('CREATE SCHEMA IF NOT EXISTS "myschema"')
  })

  it('should include CREATE TABLE IF NOT EXISTS "myschema".definitions in the DDL', async () => {
    const sql = makeSqlMock()
    await createTenantSchema(sql, 'myschema')
    const [ddl] = (sql.unsafe as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS "myschema".definitions')
  })

  it('should include CREATE TABLE IF NOT EXISTS "myschema".instances in the DDL', async () => {
    const sql = makeSqlMock()
    await createTenantSchema(sql, 'myschema')
    const [ddl] = (sql.unsafe as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS "myschema".instances')
  })

  it('should include CREATE TABLE IF NOT EXISTS "myschema".tokens in the DDL', async () => {
    const sql = makeSqlMock()
    await createTenantSchema(sql, 'myschema')
    const [ddl] = (sql.unsafe as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS "myschema".tokens')
  })

  it('should include CREATE TABLE IF NOT EXISTS "myschema".user_tasks in the DDL', async () => {
    const sql = makeSqlMock()
    await createTenantSchema(sql, 'myschema')
    const [ddl] = (sql.unsafe as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS "myschema".user_tasks')
  })

  it('should include CREATE TABLE IF NOT EXISTS "myschema".event_subscriptions in the DDL', async () => {
    const sql = makeSqlMock()
    await createTenantSchema(sql, 'myschema')
    const [ddl] = (sql.unsafe as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS "myschema".event_subscriptions')
  })

  it('should include CREATE TABLE IF NOT EXISTS "myschema".scheduled_timers in the DDL', async () => {
    const sql = makeSqlMock()
    await createTenantSchema(sql, 'myschema')
    const [ddl] = (sql.unsafe as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS "myschema".scheduled_timers')
  })

  it('should include CREATE TABLE IF NOT EXISTS "myschema".compensation_records in the DDL', async () => {
    const sql = makeSqlMock()
    await createTenantSchema(sql, 'myschema')
    const [ddl] = (sql.unsafe as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS "myschema".compensation_records')
  })

  it('should use the provided schemaName "tenant_acme" throughout the DDL', async () => {
    const sql = makeSqlMock()
    await createTenantSchema(sql, 'tenant_acme')
    const [ddl] = (sql.unsafe as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    // The schema name should appear multiple times (schema creation + each table)
    const occurrences = (ddl.match(/"tenant_acme"/g) ?? []).length
    expect(occurrences).toBeGreaterThan(1)
    // And the default test name must not appear
    expect(ddl).not.toContain('"myschema"')
  })

  it('should not use a hardcoded schema name — DDL reflects whichever schemaName is passed', async () => {
    const sqlA = makeSqlMock()
    const sqlB = makeSqlMock()
    await createTenantSchema(sqlA, 'tenant_alpha')
    await createTenantSchema(sqlB, 'tenant_beta')

    const [ddlA] = (sqlA.unsafe as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    const [ddlB] = (sqlB.unsafe as ReturnType<typeof vi.fn>).mock.calls[0] as [string]

    expect(ddlA).toContain('"tenant_alpha"')
    expect(ddlA).not.toContain('"tenant_beta"')
    expect(ddlB).toContain('"tenant_beta"')
    expect(ddlB).not.toContain('"tenant_alpha"')
  })
})
