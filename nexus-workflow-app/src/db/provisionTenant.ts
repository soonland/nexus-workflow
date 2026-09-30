import type postgres from 'postgres'
import { TenantStore } from './TenantStore.js'
import { provisionTenantSchema, VALID_TENANT_ID } from './tenantProvisioner.js'

export interface ProvisionTenantInput {
  tenantId: string
  /** Display name; defaults to the tenant id. */
  name?: string
  /** Label for the API key that is created. */
  keyName?: string
}

export interface ProvisionTenantResult {
  tenantId: string
  /** False when the tenant already existed (its schema is still checked/created). */
  tenantCreated: boolean
  /** The new API key. Shown only here — only its hash is stored. */
  plaintextKey: string
}

/**
 * Makes sure the tenant exists (registry row + schema) and issues it a new API key.
 * Safe to run repeatedly: an existing tenant is kept and only a new key is added.
 *
 * This is the same work as `POST /tenants` + `POST /tenants/:id/keys`, for callers that
 * have database access but no running server (setup scripts).
 */
export async function provisionTenantWithKey(
  sql: postgres.Sql,
  hmacSecret: string,
  input: ProvisionTenantInput,
): Promise<ProvisionTenantResult> {
  const { tenantId } = input
  if (!VALID_TENANT_ID.test(tenantId)) {
    throw new Error(`Invalid tenantId: "${tenantId}". Only alphanumeric characters, hyphens, and underscores are allowed.`)
  }

  const store = new TenantStore(sql, hmacSecret)
  let tenantCreated = false

  if (!(await store.getTenant(tenantId))) {
    await store.createTenant(tenantId, input.name ?? tenantId)
    tenantCreated = true
    try {
      await provisionTenantSchema(tenantId, sql)
    } catch (err) {
      // Same rollback as POST /tenants: no registry row without a schema.
      await store.deleteTenant(tenantId).catch(() => {})
      throw err
    }
  } else {
    // Idempotent: repairs a tenant whose schema is missing
    await provisionTenantSchema(tenantId, sql)
  }

  const { plaintext } = await store.createApiKey(tenantId, input.keyName ?? 'provisioned key')
  return { tenantId, tenantCreated, plaintextKey: plaintext }
}
