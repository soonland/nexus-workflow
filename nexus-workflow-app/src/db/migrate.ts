import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import postgres from 'postgres'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Arbitrary constant naming the migration lock; every runner of these migrations must use the same one. */
const MIGRATION_LOCK_KEY = 7_262_001

export async function runMigrations(connectionString: string): Promise<void> {
  const sql = postgres(connectionString)
  // Only one runner at a time: concurrent starts (several replicas, or test files) would otherwise
  // race on CREATE TABLE / CREATE TYPE and fail with a duplicate key on pg_type. The lock is held
  // by a reserved connection of its own and released with it.
  const lock = await sql.reserve()
  try {
    await lock`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`
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
      '009_tenant_events_webhooks.sql',
      '010_tenant_deleting_status.sql',
      '011_users.sql',
      '012_audit_log.sql',
      '013_api_key_roles.sql',
      '014_operator_keys.sql',
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
    try {
      await lock`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`
    } finally {
      lock.release()
      await sql.end()
    }
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
