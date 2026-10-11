import { Hono, type MiddlewareHandler } from 'hono'
import { auditActorOf } from '../auth/auditActor.js'
import type { AuditLog } from '../db/AuditLog.js'
import type { OperatorKeyStore } from '../db/OperatorKeyStore.js'
import type { AppVariables } from './middleware/auth.js'

export interface OperatorKeysRouterDeps {
  keys: OperatorKeyStore
  /** createOperatorKeyAdminGuard: operators and the admin key, not operator keys. Sets the principal. */
  guard: MiddlewareHandler<{ Variables: AppVariables }>
  audit?: AuditLog
}

const invalid = (message: string) => ({ error: 'VALIDATION_ERROR', message })
const MAX_NAME = 255

/**
 * /operator-keys: named, revocable credentials for programs that administer the platform.
 *  - GET /               every key (revoked and expired ones too), never a secret
 *  - POST /  {name, expiresAt?}   creates one; the plaintext is in this answer only
 *  - DELETE /:id         revokes
 */
export function createOperatorKeysRouter(deps: OperatorKeysRouterDeps): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>()
  app.use('*', deps.guard)
  // a secret is in the answer to POST, and the list says who holds what: not for caches
  app.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })

  app.get('/', async (c) => c.json({ keys: await deps.keys.list() }))

  app.post('/', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json(invalid('Invalid JSON body'), 400)
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return c.json(invalid('Body must be a JSON object'), 400)
    const { name, expiresAt } = body as Record<string, unknown>

    if (typeof name !== 'string' || name.trim() === '') return c.json(invalid('"name" must be a non-empty string'), 400)
    if (name.length > MAX_NAME) return c.json(invalid(`"name" must not exceed ${MAX_NAME} characters`), 400)

    let expires: Date | null = null
    if (expiresAt !== undefined && expiresAt !== null) {
      expires = typeof expiresAt === 'string' ? new Date(expiresAt) : new Date(Number.NaN)
      if (Number.isNaN(expires.getTime())) return c.json(invalid('"expiresAt" must be a date, e.g. 2027-01-31T00:00:00Z'), 400)
      if (expires.getTime() <= Date.now()) return c.json(invalid('"expiresAt" must be in the future'), 400)
    }

    const principal = c.get('principal')
    const actor = principal ? auditActorOf(principal) : ({ kind: 'adminKey' } as const)
    const { key, plaintext } = await deps.keys.create(name.trim(), {
      createdBy: actor.kind === 'user' ? actor.id : null,
      expiresAt: expires,
    })
    // the key's id, name and expiry, never the key itself
    await deps.audit?.record({
      action: 'operator-key.create',
      actor,
      target: key.id,
      details: { name: key.name, expiresAt: key.expiresAt?.toISOString() ?? null },
    })
    return c.json({ key, plaintext }, 201)
  })

  app.delete('/:id', async (c) => {
    const id = c.req.param('id')
    // one statement: the key comes back only to the request that actually revoked it
    const key = await deps.keys.revoke(id)
    if (!key) return c.json({ error: 'NOT_FOUND', message: `Operator key '${id}' not found or already revoked` }, 404)
    const principal = c.get('principal')
    await deps.audit?.record({
      action: 'operator-key.revoke',
      actor: principal ? auditActorOf(principal) : { kind: 'adminKey' },
      target: id,
      details: { name: key.name },
    })
    return c.json({ success: true })
  })

  return app
}
