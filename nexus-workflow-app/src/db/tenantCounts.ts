import type postgres from 'postgres'
import { schemaName } from './tenantProvisioner.js'

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

/** A tenant's counting gives up after this long, so one huge tenant cannot tie up the pool. */
export const COUNT_TIMEOUT_MS = 5_000

/**
 * Counts instances by status and unfinished tasks in one tenant's schema. Uses a single connection
 * (one transaction) and a statement timeout; a tenant that is too slow to count throws.
 */
export async function readTenantCounts(sql: postgres.Sql, tenantId: string, timeoutMs = COUNT_TIMEOUT_MS): Promise<TenantCounts> {
  // schemaName() rejects anything but letters, digits, hyphens and underscores, so it is safe to quote
  const schema = `"${schemaName(tenantId)}"`

  const { byStatus, tasks } = await sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as postgres.Sql
    await tx.unsafe(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(timeoutMs))}`)
    return {
      byStatus: await tx.unsafe<Array<{ status: string; n: number }>>(`SELECT status, count(*)::int AS n FROM ${schema}.instances GROUP BY status`),
      tasks: await tx.unsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM ${schema}.user_tasks WHERE status IN ('open', 'claimed')`),
    }
  })

  const instances = Object.fromEntries(INSTANCE_STATUSES.map((status) => [status, 0])) as Record<CountedStatus, number>
  for (const row of byStatus) {
    if (row.status in instances) instances[row.status as CountedStatus] = row.n
  }
  return { instances, pendingTasks: tasks[0]?.n ?? 0 }
}
