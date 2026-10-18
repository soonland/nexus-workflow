import type { MiddlewareHandler } from 'hono'
import type { TenantSchemaHealth } from '../../db/tenantMigrations.js'
import type { AppVariables } from './auth.js'

/**
 * Refuses (503) requests for a tenant whose schema failed its migrations and so is behind the
 * code. Must run after the auth middleware, which sets `tenantId`. Other tenants are unaffected.
 */
export function createTenantSchemaGuard(health: TenantSchemaHealth): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    const tenantId = c.get('tenantId')
    if (tenantId && health.isBehind(tenantId)) {
      return c.json(
        { error: 'TENANT_SCHEMA_OUTDATED', message: `Tenant '${tenantId}' is unavailable: its schema failed to migrate. Contact the operator.` },
        503,
      )
    }
    return next()
  }
}
