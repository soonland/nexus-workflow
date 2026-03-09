import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import postgres from 'postgres'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function runMigrations(connectionString: string): Promise<void> {
  const sql = postgres(connectionString)
  try {
    // Create migrations tracking table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT        PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `

    const migrations = [
      '001_initial_schema.sql',
      '002_gateway_join_states_instance_idx.sql',
    ]

    for (const file of migrations) {
      const [row] = await sql`SELECT 1 FROM schema_migrations WHERE version = ${file}`
      if (row) continue

      const sqlText = readFileSync(resolve(__dirname, 'migrations', file), 'utf8')

      // Cast tx to Sql so TypeScript recognises both the tagged-template call signature
      // and the unsafe() method. TransactionSql extends Omit<Sql, ...> which loses the
      // call signature in some TS versions.
      await sql.begin(async (txRaw) => {
        const tx = txRaw as unknown as postgres.Sql
        await tx.unsafe(sqlText)
        await tx`INSERT INTO schema_migrations (version) VALUES (${file})`
      })

      console.log(`Applied migration: ${file}`)
    }
  } finally {
    await sql.end()
  }
}
