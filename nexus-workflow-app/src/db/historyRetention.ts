import type postgres from 'postgres'
import { schemaName } from './tenantProvisioner.js'

const DAY_MS = 86_400_000
const BATCH_SIZE = 1000

/**
 * Removes the variable snapshots from the step history of instances that finished (completed or
 * terminated) more than `retentionDays` ago. The step records themselves stay; only the copy of
 * the instance's variables goes. Instances still running are never touched. Idempotent.
 *
 * A cancelled instance is `terminated` without a `completed_at` (the engine only sets that on
 * normal completion), so its finish time is taken from its last step. Works in batches so one
 * run never holds a long lock. App-side housekeeping; the engine is not involved.
 * Returns how many step records were stripped.
 */
export async function purgeHistorySnapshots(sql: postgres.Sql, tenantId: string, retentionDays: number): Promise<number> {
  // schemaName() rejects anything but letters, digits, hyphens and underscores, so it is safe to quote
  const schema = `"${schemaName(tenantId)}"`
  const cutoff = new Date(Date.now() - retentionDays * DAY_MS)
  let total = 0
  for (;;) {
    const rows = await sql.unsafe<Array<{ id: string }>>(
      `UPDATE ${schema}.history_entries
          SET data = data - 'variablesSnapshot'
        WHERE id IN (
          SELECT h.id
            FROM ${schema}.history_entries h
            JOIN ${schema}.instances i ON i.id = h.instance_id
           WHERE i.status IN ('completed', 'terminated')
             AND h.data ? 'variablesSnapshot'
             AND COALESCE(
                   i.completed_at,
                   (SELECT max(COALESCE((l.data->>'completedAt')::timestamptz, l.started_at))
                      FROM ${schema}.history_entries l WHERE l.instance_id = i.id)
                 ) < $1
           LIMIT ${BATCH_SIZE}
        )
        RETURNING id`,
      [cutoff],
    )
    total += rows.length
    if (rows.length < BATCH_SIZE) return total
  }
}
