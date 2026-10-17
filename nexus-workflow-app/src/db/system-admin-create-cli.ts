import { parseArgs } from 'node:util'
import postgres from 'postgres'
import { createSystemAdminWithInvite, removeSystemAdmin } from '../auth/createSystemAdmin.js'
import { config } from '../config.js'
import { UserInputError } from './UserStore.js'
import { runMigrations } from './migrate.js'

const USAGE = `Usage: pnpm system-admin:create <email> [options]

Makes <email> a system admin and prints a one-time link where they choose their password. A system
admin is the only role that can create operators; the role cannot be granted from the API or the
console, only here. Run it again for each further system admin, or to get back in if access is lost:
an existing account is kept (and re-enabled), gains the role once, and gets a new link that replaces
the old one.

Reads DATABASE_URL and API_KEY_HMAC_SECRET from the environment, like the server, so run it with
the same values the server uses (the link is checked against that secret).

Options:
  --name <name>      Display name for a new account (default: the part of the email before the @)
  --base-url <url>   Where the console is served, used to build the link
                     (default: PUBLIC_ORIGIN, or http://localhost:<PORT>)
  --remove           Take the system admin role away from <email> instead (the account and its other
                     roles stay). Refused for the last active operator or system admin.
`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' },
    'base-url': { type: 'string' },
    remove: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
})

const [email] = positionals
if (values.help || !email || positionals.length > 1) {
  console.log(USAGE)
  process.exit(values.help ? 0 : 1)
}

// The memberships table must accept the role; migrations are idempotent.
await runMigrations(config.databaseUrl)

const sql = postgres(config.databaseUrl)
try {
  if (values.remove) {
    const result = await removeSystemAdmin(sql, { email })
    console.log(result.removed ? `${result.user.email} is no longer a system admin.` : `${result.user.email} is not a system admin; nothing changed.`)
  } else {
    const result = await createSystemAdminWithInvite(
      sql,
      { hmacSecret: config.apiKeyHmacSecret, inviteTtlMs: config.inviteTtlMs },
      { email, ...(values.name ? { name: values.name } : {}) },
    )
    const baseUrl = (values['base-url'] ?? config.publicOrigin ?? `http://localhost:${config.port}`).replace(/\/+$/, '')

    console.log(result.created ? `Created system admin ${result.user.email}.` : `${result.user.email} already existed; they are now a system admin.`)
    console.log(`\nInvitation link (shown only once, valid until ${result.invite.expiresAt.toISOString()}):\n\n  ${baseUrl}/console/invite/${result.invite.token}\n`)
  }
} catch (err) {
  if (err instanceof UserInputError) {
    console.error(err.message)
    process.exit(1)
  }
  throw err
} finally {
  await sql.end()
}
