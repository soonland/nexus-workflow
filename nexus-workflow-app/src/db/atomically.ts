import type postgres from 'postgres'

/**
 * Something to do in the same transaction as a change, once the change has taken effect (for example
 * writing the audit entry). If it throws, the change is rolled back with it.
 */
export type Within<R> = (tx: postgres.Sql, result: R) => Promise<void>

/**
 * Runs `work`. With `within`, `work` and `within` share one transaction: `within` runs only when `work`
 * produced a result (not null or false, i.e. something changed), and a failure in either undoes both.
 * Without it, `work` runs as it always did.
 */
export async function atomically<R>(
  sql: postgres.Sql,
  work: (db: postgres.Sql) => Promise<R>,
  within?: Within<NonNullable<R>>,
): Promise<R> {
  if (!within) return work(sql)
  return (await sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as postgres.Sql
    const result = await work(tx)
    if (result) await within(tx, result as NonNullable<R>)
    return result
  })) as R
}
