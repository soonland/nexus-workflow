import type postgres from 'postgres'
import { createTenantSchema } from './schema.js'

const VALID_TENANT_ID = /^[a-zA-Z0-9_-]+$/

function schemaName(tenantId: string): string {
  if (!VALID_TENANT_ID.test(tenantId)) {
    throw new Error(`Invalid tenantId: "${tenantId}". Only alphanumeric characters, hyphens, and underscores are allowed.`)
  }
  return `tenant_${tenantId}`
}

/**
 * Provisions a new tenant by creating their dedicated PostgreSQL schema
 * and all workflow tables within it.
 *
 * Safe to call multiple times — uses CREATE SCHEMA IF NOT EXISTS and
 * CREATE TABLE IF NOT EXISTS throughout.
 */
export async function provisionTenantSchema(tenantId: string, sql: postgres.Sql): Promise<void> {
  await createTenantSchema(sql, schemaName(tenantId))
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
