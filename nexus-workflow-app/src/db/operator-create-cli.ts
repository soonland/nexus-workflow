import { parseArgs } from 'node:util'
import postgres from 'postgres'
import { createOperatorWithInvite } from '../auth/createOperator.js'
import { config } from '../config.js'
import { UserInputError } from './UserStore.js'
import { runMigrations } from './migrate.js'

const USAGE = `Usage: pnpm operator:create <email> [options]

Makes <email> a platform operator and prints a one-time link where they choose their password.
This is how the first operator is created, and the way back in if every operator is locked out.
Safe to run again: an existing account is kept (and re-enabled), gains the operator role once, and
gets a new link that replaces the old one.

Reads DATABASE_URL and API_KEY_HMAC_SECRET from the environment, like the server, so run it with
the same values the server uses (the link is checked against that secret).

Options:
  --name <name>      Display name for a new account (default: the part of the email before the @)
  --base-url <url>   Where the console is served, used to build the link
                     (default: PUBLIC_ORIGIN, or http://localhost:<PORT>)
`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' },
    'base-url': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
})

const [email] = positionals
if (values.help || !email || positionals.length > 1) {
  console.log(USAGE)
  process.exit(values.help ? 0 : 1)
}

// The users table must exist; migrations are idempotent.
await runMigrations(config.databaseUrl)

const sql = postgres(config.databaseUrl)
try {
  const result = await createOperatorWithInvite(
    sql,
    { hmacSecret: config.apiKeyHmacSecret, inviteTtlMs: config.inviteTtlMs },
    { email, ...(values.name ? { name: values.name } : {}) },
  )
  const baseUrl = (values['base-url'] ?? config.publicOrigin ?? `http://localhost:${config.port}`).replace(/\/+$/, '')

  console.log(result.created ? `Created operator ${result.user.email}.` : `${result.user.email} already existed; they are now an operator.`)
  console.log(`\nInvitation link (shown only once, valid until ${result.invite.expiresAt.toISOString()}):\n\n  ${baseUrl}/console/invite/${result.invite.token}\n`)
} catch (err) {
  if (err instanceof UserInputError) {
    console.error(err.message)
    process.exit(1)
  }
  throw err
} finally {
  await sql.end()
}
