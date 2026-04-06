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
      '003_execution_events.sql',
      '004_definition_source_xml.sql',
      '005_webhooks.sql',
      '006_compensation_records.sql',
      '007_tenant_registry.sql',
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

export async function resetDatabase(connectionString: string): Promise<void> {
  const sql = postgres(connectionString)
  try {
    await sql`
      DROP TABLE IF EXISTS
        execution_events,
        scheduled_timers,
        history_entries,
        gateway_join_states,
        event_subscriptions,
        user_tasks,
        variable_scopes,
        tokens,
        instances,
        definitions,
        schema_migrations
      CASCADE
    `
    console.log('Database reset: all tables dropped')
  } finally {
    await sql.end()
  }

  await runMigrations(connectionString)
}
