import { describe, it, expect, vi, beforeEach } from 'vitest'
import type postgres from 'postgres'

// Mock schema.ts so we can observe calls without executing real DDL.
// The mock is hoisted above imports by Vitest.
vi.mock('./schema.js', () => ({
  createTenantSchema: vi.fn().mockResolvedValue(undefined),
}))

import { createTenantSchema } from './schema.js'
import { provisionTenantSchema, dropTenantSchema } from './tenantProvisioner.js'

function makeSqlMock() {
  const unsafe = vi.fn().mockResolvedValue([])
  return { unsafe } as unknown as postgres.Sql
}

const mockedCreateTenantSchema = vi.mocked(createTenantSchema)

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── provisionTenantSchema ────────────────────────────────────────────────────

describe('provisionTenantSchema', () => {
  it('should call createTenantSchema with the prefixed schema name "tenant_{tenantId}"', async () => {
    const sql = makeSqlMock()
    await provisionTenantSchema('acme', sql)
    expect(mockedCreateTenantSchema).toHaveBeenCalledExactlyOnceWith(sql, 'tenant_acme')
  })

  it('should pass the sql instance through to createTenantSchema unchanged', async () => {
    const sql = makeSqlMock()
    await provisionTenantSchema('my-tenant', sql)
    const [receivedSql] = mockedCreateTenantSchema.mock.calls[0]!
    expect(receivedSql).toBe(sql)
  })

  it('should accept tenant IDs that contain only alphanumeric characters', async () => {
    const sql = makeSqlMock()
    await expect(provisionTenantSchema('abc123', sql)).resolves.toBeUndefined()
  })

  it('should accept tenant IDs that contain hyphens', async () => {
    const sql = makeSqlMock()
    await expect(provisionTenantSchema('my-tenant-01', sql)).resolves.toBeUndefined()
  })

  it('should accept tenant IDs that contain underscores', async () => {
    const sql = makeSqlMock()
    await expect(provisionTenantSchema('my_tenant_01', sql)).resolves.toBeUndefined()
  })

  it('should throw when tenantId contains a space', async () => {
    const sql = makeSqlMock()
    await expect(provisionTenantSchema('abc def', sql)).rejects.toThrow(
      'Invalid tenantId: "abc def"'
    )
    expect(mockedCreateTenantSchema).not.toHaveBeenCalled()
  })

  it('should throw when tenantId contains a semicolon', async () => {
    const sql = makeSqlMock()
    await expect(provisionTenantSchema('abc;drop', sql)).rejects.toThrow(
      'Invalid tenantId: "abc;drop"'
    )
    expect(mockedCreateTenantSchema).not.toHaveBeenCalled()
  })

  it('should throw when tenantId contains path traversal characters', async () => {
    const sql = makeSqlMock()
    await expect(provisionTenantSchema('../../etc', sql)).rejects.toThrow(
      'Invalid tenantId: "../../etc"'
    )
    expect(mockedCreateTenantSchema).not.toHaveBeenCalled()
  })

  it('should throw when tenantId contains a dot', async () => {
    const sql = makeSqlMock()
    await expect(provisionTenantSchema('tenant.name', sql)).rejects.toThrow(
      'Invalid tenantId: "tenant.name"'
    )
  })

  it('should throw when tenantId contains a quote character', async () => {
    const sql = makeSqlMock()
    await expect(provisionTenantSchema('tenant"name', sql)).rejects.toThrow(
      'Invalid tenantId: "tenant"name"'
    )
  })

  it('should throw when tenantId is an empty string', async () => {
    const sql = makeSqlMock()
    await expect(provisionTenantSchema('', sql)).rejects.toThrow(
      'Invalid tenantId: ""'
    )
  })

  it('should include the allowed-character description in the error message', async () => {
    const sql = makeSqlMock()
    await expect(provisionTenantSchema('bad id!', sql)).rejects.toThrow(
      'Only alphanumeric characters, hyphens, and underscores are allowed.'
    )
  })
})

// ─── dropTenantSchema ─────────────────────────────────────────────────────────

describe('dropTenantSchema', () => {
  it('should call sql.unsafe with a DROP SCHEMA statement for "tenant_{tenantId}"', async () => {
    const sql = makeSqlMock()
    await dropTenantSchema('acme', sql)
    expect(sql.unsafe).toHaveBeenCalledExactlyOnceWith('DROP SCHEMA IF EXISTS "tenant_acme" CASCADE')
  })

  it('should use the correct quoted schema name in the DROP statement', async () => {
    const sql = makeSqlMock()
    await dropTenantSchema('my-org_01', sql)
    const [ddl] = (sql.unsafe as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(ddl).toBe('DROP SCHEMA IF EXISTS "tenant_my-org_01" CASCADE')
  })

  it('should resolve without a value on success', async () => {
    const sql = makeSqlMock()
    await expect(dropTenantSchema('acme', sql)).resolves.toBeUndefined()
  })

  it('should throw when tenantId contains a space', async () => {
    const sql = makeSqlMock()
    await expect(dropTenantSchema('abc def', sql)).rejects.toThrow(
      'Invalid tenantId: "abc def"'
    )
    expect(sql.unsafe).not.toHaveBeenCalled()
  })

  it('should throw when tenantId contains a semicolon', async () => {
    const sql = makeSqlMock()
    await expect(dropTenantSchema('abc;drop', sql)).rejects.toThrow(
      'Invalid tenantId: "abc;drop"'
    )
    expect(sql.unsafe).not.toHaveBeenCalled()
  })

  it('should throw when tenantId contains path traversal characters', async () => {
    const sql = makeSqlMock()
    await expect(dropTenantSchema('../../etc', sql)).rejects.toThrow(
      'Invalid tenantId: "../../etc"'
    )
    expect(sql.unsafe).not.toHaveBeenCalled()
  })

  it('should throw when tenantId is an empty string', async () => {
    const sql = makeSqlMock()
    await expect(dropTenantSchema('', sql)).rejects.toThrow(
      'Invalid tenantId: ""'
    )
    expect(sql.unsafe).not.toHaveBeenCalled()
  })

  it('should include the allowed-character description in the error message', async () => {
    const sql = makeSqlMock()
    await expect(dropTenantSchema('bad id!', sql)).rejects.toThrow(
      'Only alphanumeric characters, hyphens, and underscores are allowed.'
    )
  })
})
