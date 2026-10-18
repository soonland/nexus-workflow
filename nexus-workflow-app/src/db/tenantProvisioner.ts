import type postgres from 'postgres'
import { migrateTenantSchema } from './tenantMigrations.js'

export const VALID_TENANT_ID = /^[a-zA-Z0-9_-]+$/

/** The Postgres schema that holds a tenant's data. Throws for an id that could not be a safe schema name. */
export function schemaName(tenantId: string): string {
  if (!VALID_TENANT_ID.test(tenantId)) {
    throw new Error(`Invalid tenantId: "${tenantId}". Only alphanumeric characters, hyphens, and underscores are allowed.`)
  }
  return `tenant_${tenantId}`
}

/**
 * Provisions a tenant by creating their dedicated PostgreSQL schema and bringing it fully up to
 * date (every tenant migration, tracked in the schema's own `schema_migrations` table).
 *
 * Safe to call multiple times — only migrations not yet recorded are applied.
 */
export async function provisionTenantSchema(tenantId: string, sql: postgres.Sql): Promise<void> {
  await migrateTenantSchema(sql, schemaName(tenantId))
}

/**
 * Drops the tenant's schema and all its data.
 *
 * **Destructive — admin only.** This permanently deletes all workflow
 * definitions, instances, tokens, and related data for the tenant.
 * The `public.tenants` and `public.api_keys` rows are NOT removed here;
 * handle those separately before or after calling this function.
 */
export async function dropTenantSchema(tenantId: string, sql: postgres.Sql): Promise<void> {
  const name = schemaName(tenantId)
  // schemaName() validates tenantId; safe to interpolate into sql.unsafe.
  await sql.unsafe(`DROP SCHEMA IF EXISTS "${name}" CASCADE`)
}
