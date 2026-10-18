import type postgres from 'postgres'
import { schemaName } from './tenantProvisioner.js'

const DAY_MS = 86_400_000

/**
 * Removes the variable snapshots from the step history of instances that finished (completed or
 * terminated) more than `retentionDays` ago. The step records themselves stay; only the copy of
 * the instance's variables goes. Instances still running are never touched. Idempotent.
 *
 * App-side housekeeping; the engine is not involved. Returns how many step records were stripped.
 */
export async function purgeHistorySnapshots(sql: postgres.Sql, tenantId: string, retentionDays: number): Promise<number> {
  // schemaName() rejects anything but letters, digits, hyphens and underscores, so it is safe to quote
  const schema = `"${schemaName(tenantId)}"`
  const cutoff = new Date(Date.now() - retentionDays * DAY_MS)
  const rows = await sql.unsafe<Array<{ id: string }>>(
    `UPDATE ${schema}.history_entries h
        SET data = h.data - 'variablesSnapshot'
       FROM ${schema}.instances i
      WHERE i.id = h.instance_id
        AND i.status IN ('completed', 'terminated')
        AND i.completed_at < $1
        AND h.data ? 'variablesSnapshot'
      RETURNING h.id`,
    [cutoff],
  )
  return rows.length
}
