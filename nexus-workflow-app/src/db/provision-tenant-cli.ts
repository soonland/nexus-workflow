import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import postgres from 'postgres'
import { config } from '../config.js'
import { runMigrations } from './migrate.js'
import { provisionTenantWithKey } from './provisionTenant.js'
import { upsertEnvVar } from './envFile.js'

const USAGE = `Usage: pnpm tenant:provision <tenantId> [options]

Creates the tenant (registry row + schema) if it does not exist and issues it a new API key.
Reads DATABASE_URL and API_KEY_HMAC_SECRET from the environment, like the server, so run it
with the same values the server uses.

Options:
  --name <name>       Display name for a new tenant (default: the tenant id)
  --key-name <name>   Label for the API key (default: "provisioned key")
  --env-file <path>   Write the key into this dotenv file instead of printing it
  --env-var <NAME>    Variable to set in --env-file (default: WORKFLOW_API_KEY)
`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' },
    'key-name': { type: 'string' },
    'env-file': { type: 'string' },
    'env-var': { type: 'string', default: 'WORKFLOW_API_KEY' },
    help: { type: 'boolean', short: 'h' },
  },
})

const [tenantId] = positionals
if (values.help || !tenantId || positionals.length > 1) {
  console.log(USAGE)
  process.exit(values.help ? 0 : 1)
}

// The tenants table must exist; migrations are idempotent.
await runMigrations(config.databaseUrl)

const sql = postgres(config.databaseUrl)
try {
  const result = await provisionTenantWithKey(sql, config.apiKeyHmacSecret, {
    tenantId,
    ...(values.name ? { name: values.name } : {}),
    ...(values['key-name'] ? { keyName: values['key-name'] } : {}),
  })

  console.log(result.tenantCreated ? `Created tenant '${tenantId}'.` : `Tenant '${tenantId}' already exists.`)

  const envFile = values['env-file']
  if (envFile) {
    const path = resolve(envFile)
    const envVar = values['env-var']
    const before = existsSync(path) ? readFileSync(path, 'utf8') : ''
    writeFileSync(path, upsertEnvVar(before, envVar, result.plaintextKey))
    // The key itself is deliberately not printed when it goes into a file.
    console.log(`Wrote a new API key to ${envVar} in ${path}`)
  } else {
    console.log(`API key (shown only once): ${result.plaintextKey}`)
  }
} finally {
  await sql.end()
}
