import { createHmac } from 'node:crypto'
import type { Context, Next } from 'hono'
import type postgres from 'postgres'

/**
 * Hono context variables populated by the auth middleware.
 * Import this type in route handlers to access `c.get('tenantId')`.
 */
export type AppVariables = {
  tenantId: string
}

function hashKey(raw: string, secret: string): string {
  return createHmac('sha256', secret).update(raw).digest('hex')
}

/**
 * Hono middleware that enforces API key authentication via the database.
 *
 * Reads the `Authorization: Bearer <key>` header, hashes it with HMAC-SHA256
 * (using `hmacSecret`), and looks it up in `public.api_keys` joined with
 * `public.tenants`. Returns 401 if the key is unknown, has been revoked, or
 * belongs to a non-active tenant. On success, attaches the resolved `tenantId`
 * to the Hono context and fires a background update of `last_used_at`.
 *
 * The `/health` path is always bypassed so liveness probes work without credentials.
 */
export function createAuthMiddleware(sql: postgres.Sql, hmacSecret: string) {
  return async function authMiddleware(c: Context<{ Variables: AppVariables }>, next: Next) {
    if (c.req.path === '/health') {
      return next()
    }

    const authHeader = c.req.header('Authorization')
    if (!authHeader) {
      return c.json({ error: 'unauthorized' }, 401, {
        'WWW-Authenticate': 'Bearer realm="nexus-workflow"',
      })
    }

    const [scheme, key] = authHeader.split(' ')
    if (scheme !== 'Bearer' || !key) {
      return c.json({ error: 'unauthorized' }, 401, {
        'WWW-Authenticate': 'Bearer realm="nexus-workflow"',
      })
    }

    const keyHash = hashKey(key, hmacSecret)
    const rows = await sql<{ tenant_id: string; revoked_at: Date | null }[]>`
      SELECT k.tenant_id, k.revoked_at
      FROM public.api_keys k
      JOIN public.tenants t ON t.id = k.tenant_id
      WHERE k.key_hash = ${keyHash}
        AND t.status = 'active'
      LIMIT 1
    `

    const row = rows[0]
    if (!row || row.revoked_at !== null) {
      return c.json({ error: 'unauthorized' }, 401, {
        'WWW-Authenticate': 'Bearer realm="nexus-workflow"',
      })
    }

    c.set('tenantId', row.tenant_id)

    // Fire-and-forget: update last_used_at without blocking the request
    sql`UPDATE public.api_keys SET last_used_at = now() WHERE key_hash = ${keyHash}`.catch(err => {
      console.warn('[auth] failed to update last_used_at:', err)
    })

    return next()
  }
}
