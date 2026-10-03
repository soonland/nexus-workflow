import { createHmac } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import type postgres from 'postgres'
import { canUseTenant, type Principal } from '../../auth/principal.js'
import { readSessionToken } from '../../auth/sessionCookie.js'
import type { SessionStore } from '../../db/SessionStore.js'
import type { UserStore } from '../../db/UserStore.js'
import { CSRF_FAILURE, isCsrfSafe } from './csrf.js'

/**
 * Hono context variables populated by the auth middleware.
 * Import this type in route handlers to access `c.get('tenantId')`.
 */
export type AppVariables = {
  tenantId: string
  /** Who is calling, set once the credential has been checked. */
  principal?: Principal
}

/** What the middleware needs to let signed-in people (not just API keys) use a tenant's routes. */
export interface SessionAuthDeps {
  sessions: SessionStore
  users: UserStore
  /** The origin the console is served from, for the CSRF check on sessions. */
  publicOrigin?: string | undefined
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
 * With `sessionAuth`, a request that carries no `Authorization` header but a valid session cookie
 * is also accepted, as a tenant manager: the tenant is named in the `X-Tenant` header and must be
 * one the user manages (and active). State-changing session requests must pass the CSRF check.
 * Bearer credentials always win over a cookie, so a key is never combined with a session.
 * Callers who are not allowed get 401 (no valid credential), 400 (tenant not named) or 403 (not
 * theirs); a tenant that does not exist is indistinguishable from one they may not use.
 *
 * The `/health` path is always bypassed so liveness probes work without credentials.
 */
export function createAuthMiddleware(
  sql: postgres.Sql,
  hmacSecret: string,
  sessionAuth?: SessionAuthDeps,
): MiddlewareHandler<{ Variables: AppVariables }> {
  return async function authMiddleware(c, next) {
    if (c.req.path === '/health') {
      return next()
    }

    const authHeader = c.req.header('Authorization')
    if (!authHeader) {
      const token = sessionAuth ? readSessionToken(c) : null
      if (!sessionAuth || !token) {
        return c.json({ error: 'unauthorized' }, 401, {
          'WWW-Authenticate': 'Bearer realm="nexus-workflow"',
        })
      }
      const refused = await authenticateSession(c, sql, sessionAuth, token)
      return refused ?? next()
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
    c.set('principal', { kind: 'apiKey', tenantId: row.tenant_id })

    // Fire-and-forget: update last_used_at without blocking the request
    sql`UPDATE public.api_keys SET last_used_at = now() WHERE key_hash = ${keyHash}`.catch(err => {
      console.warn('[auth] failed to update last_used_at:', err)
    })

    return next()
  }
}

const FORBIDDEN = { error: 'FORBIDDEN', message: 'Not allowed to use this tenant' } as const

/** Authenticates a session request as a tenant manager: null if allowed (context set), else the refusal. */
async function authenticateSession(
  c: Parameters<MiddlewareHandler<{ Variables: AppVariables }>>[0],
  sql: postgres.Sql,
  deps: SessionAuthDeps,
  token: string,
): Promise<Response | null> {
  const resolved = await deps.sessions.resolve(token)
  if (!resolved) {
    return c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer realm="nexus-workflow"' })
  }
  if (!isCsrfSafe(c, deps.publicOrigin)) return c.json(CSRF_FAILURE, 403)

  const tenantId = c.req.header('x-tenant')
  if (!tenantId) {
    return c.json({ error: 'TENANT_REQUIRED', message: 'Send the tenant you mean in the X-Tenant header' }, 400)
  }

  const principal: Principal = {
    kind: 'user',
    user: resolved.user,
    memberships: await deps.users.listMemberships(resolved.user.id),
  }
  if (!canUseTenant(principal, tenantId)) return c.json(FORBIDDEN, 403)

  // Keys are refused for a suspended or deleting tenant, and so are its managers
  const active = await sql`SELECT 1 FROM public.tenants WHERE id = ${tenantId} AND status = 'active'`
  if (active.length === 0) return c.json(FORBIDDEN, 403)

  c.set('tenantId', tenantId)
  c.set('principal', principal)
  return null
}
