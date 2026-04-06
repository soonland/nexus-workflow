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
      '008_tenant_default.sql',
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
    // Drop all tenant schemas (tenant_default plus any provisioned at runtime)
    const schemas = await sql<{ nspname: string }[]>`
      SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant_%'
    `
    for (const { nspname } of schemas) {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${nspname}" CASCADE`)
    }
    await sql`
      DROP TABLE IF EXISTS
        execution_events,
        webhook_registrations,
        api_keys,
        tenants,
        schema_migrations
      CASCADE
    `
    console.log('Database reset: all tables and tenant schemas dropped')
  } finally {
    await sql.end()
  }

  await runMigrations(connectionString)
}
