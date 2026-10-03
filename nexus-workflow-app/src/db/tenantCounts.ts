import type postgres from 'postgres'
import { VALID_TENANT_ID } from './tenantProvisioner.js'

/** The instance statuses the engine uses. */
export const INSTANCE_STATUSES = ['pending', 'active', 'suspended', 'completed', 'terminated'] as const
export type CountedStatus = (typeof INSTANCE_STATUSES)[number]

/**
 * How busy a tenant is, as numbers only. Deliberately nothing else: the operator role runs the
 * platform and must not see what the tenant's workflows contain (names, variables, definitions).
 */
export interface TenantCounts {
  instances: Record<CountedStatus, number>
  /** Tasks that are open or claimed, i.e. not yet done. */
  pendingTasks: number
}

/** Counts instances by status and unfinished tasks in one tenant's schema. */
export async function readTenantCounts(sql: postgres.Sql, tenantId: string): Promise<TenantCounts> {
  if (!VALID_TENANT_ID.test(tenantId)) throw new Error(`Invalid tenantId: "${tenantId}"`)
  // The id is validated above: only letters, digits, hyphens and underscores reach the identifier.
  const schema = `"tenant_${tenantId}"`

  const [byStatus, tasks] = await Promise.all([
    sql.unsafe<Array<{ status: string; n: number }>>(`SELECT status, count(*)::int AS n FROM ${schema}.instances GROUP BY status`),
    sql.unsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM ${schema}.user_tasks WHERE status IN ('open', 'claimed')`),
  ])

  const instances = Object.fromEntries(INSTANCE_STATUSES.map((status) => [status, 0])) as Record<CountedStatus, number>
  for (const row of byStatus) {
    if (row.status in instances) instances[row.status as CountedStatus] = row.n
  }
  return { instances, pendingTasks: tasks[0]?.n ?? 0 }
}
