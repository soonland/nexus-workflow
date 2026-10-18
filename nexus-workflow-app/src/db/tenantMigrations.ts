import type postgres from 'postgres'
import { createTenantSchema } from './schema.js'

/**
 * One step in the life of a tenant schema. `run` executes inside a transaction whose
 * `search_path` is the tenant's schema, so unqualified table names refer to the tenant's tables.
 */
export interface TenantMigration {
  /** Unique, sortable id; recorded in the tenant's own `schema_migrations` table once applied. */
  version: string
  run(tx: postgres.Sql, schemaName: string): Promise<void>
}

/**
 * Ordered list of tenant-schema migrations.
 *
 * `001_baseline` is the schema as it was before tenant migrations existed (`createTenantSchema`,
 * idempotent, so it is safe to run against schemas created earlier). `createTenantSchema` is
 * frozen: every later change to a tenant's tables is a NEW entry appended here, never an edit of
 * the baseline, so a new tenant and a long-lived one both end up identical by replaying this list.
 * Entries must never be reordered or removed.
 */
export const TENANT_MIGRATIONS: readonly TenantMigration[] = [
  {
    version: '001_baseline',
    run: (tx, schemaName) => createTenantSchema(tx, schemaName),
  },
]

/** Arbitrary constant namespacing the per-tenant migration advisory locks. */
const TENANT_MIGRATION_LOCK_NAMESPACE = 7_262_002

const VALID_SCHEMA = /^tenant_[a-zA-Z0-9_-]+$/

/**
 * Brings one tenant schema up to date, applying the migrations it has not recorded yet (creating
 * the schema if needed). Each migration runs in its own transaction together with its bookkeeping
 * row, so a failure leaves the tenant at the last migration that fully applied. Concurrent runners
 * (several replicas starting together) serialize on a per-schema advisory lock.
 *
 * Returns the versions applied by this call. Throws, naming the failing version, on failure.
 */
export async function migrateTenantSchema(
  sql: postgres.Sql,
  schemaName: string,
  migrations: readonly TenantMigration[] = TENANT_MIGRATIONS,
): Promise<string[]> {
  if (!VALID_SCHEMA.test(schemaName)) throw new Error(`Invalid tenant schema name: "${schemaName}"`)

  const applied: string[] = []
  for (const migration of migrations) {
    await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as postgres.Sql
      await tx`SELECT pg_advisory_xact_lock(${TENANT_MIGRATION_LOCK_NAMESPACE}, hashtext(${schemaName}))`
      // schemaName is validated above; identifiers cannot be bound as parameters.
      await tx.unsafe(`
        CREATE SCHEMA IF NOT EXISTS "${schemaName}";
        CREATE TABLE IF NOT EXISTS "${schemaName}".schema_migrations (
          version    TEXT        PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        SET LOCAL search_path TO "${schemaName}", public;
      `)
      const done = await tx.unsafe(`SELECT 1 FROM "${schemaName}".schema_migrations WHERE version = $1`, [migration.version])
      if (done.length > 0) return
      try {
        await migration.run(tx, schemaName)
      } catch (err) {
        throw new Error(`tenant migration ${migration.version} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
      }
      await tx.unsafe(`INSERT INTO "${schemaName}".schema_migrations (version) VALUES ($1)`, [migration.version])
      applied.push(migration.version)
    })
  }
  return applied
}

export interface TenantMigrationFailure {
  tenantId: string
  error: string
}

export interface MigrateAllTenantsResult {
  /** Tenants that are now up to date (including those that already were). */
  upToDate: string[]
  /** Tenants whose migration failed; they are behind and must not be served. */
  failed: TenantMigrationFailure[]
}

/**
 * Brings every tenant (except those being deleted) up to date. A failure on one tenant is
 * recorded and logged and the others carry on. `health`, if given, is updated per tenant.
 */
export async function migrateAllTenants(
  sql: postgres.Sql,
  options: { migrations?: readonly TenantMigration[]; health?: TenantSchemaHealth } = {},
): Promise<MigrateAllTenantsResult> {
  const tenants = await sql<{ id: string }[]>`SELECT id FROM public.tenants WHERE status <> 'deleting' ORDER BY id`
  const result: MigrateAllTenantsResult = { upToDate: [], failed: [] }
  for (const { id } of tenants) {
    try {
      const applied = await migrateTenantSchema(sql, `tenant_${id}`, options.migrations)
      if (applied.length > 0) console.log(`[tenant-migrations] tenant '${id}': applied ${applied.join(', ')}`)
      options.health?.markCurrent(id)
      result.upToDate.push(id)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[tenant-migrations] tenant '${id}' is BEHIND and will not be served: ${message}`)
      options.health?.markBehind(id, message)
      result.failed.push({ tenantId: id, error: message })
    }
  }
  if (result.failed.length > 0) {
    console.error(
      `[tenant-migrations] ${result.failed.length} of ${tenants.length} tenant(s) failed: ${result.failed.map(f => f.tenantId).join(', ')}`,
    )
  }
  return result
}

/** Which tenants failed their last migration run and so must not be served. In-memory; rebuilt on startup. */
export class TenantSchemaHealth {
  private readonly behind = new Map<string, string>()

  markBehind(tenantId: string, error: string): void {
    this.behind.set(tenantId, error)
  }

  markCurrent(tenantId: string): void {
    this.behind.delete(tenantId)
  }

  isBehind(tenantId: string): boolean {
    return this.behind.has(tenantId)
  }

  failures(): TenantMigrationFailure[] {
    return [...this.behind].map(([tenantId, error]) => ({ tenantId, error }))
  }
}
