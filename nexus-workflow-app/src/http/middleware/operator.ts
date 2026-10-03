import type { MiddlewareHandler } from 'hono'
import { isAdminKeyHeader } from '../../auth/adminKey.js'
import { isOperator, type Principal } from '../../auth/principal.js'
import { readSessionToken } from '../../auth/sessionCookie.js'
import type { SessionStore } from '../../db/SessionStore.js'
import type { UserStore } from '../../db/UserStore.js'
import type { AppVariables } from './auth.js'
import { CSRF_FAILURE, isCsrfSafe } from './csrf.js'

export interface OperatorGuardDeps {
  /** The platform admin key (ADMIN_API_KEY); a break-glass operator credential. */
  adminApiKey: string
  sessions: SessionStore
  users: UserStore
  /** The origin the console is served from, for the CSRF check on sessions. */
  publicOrigin?: string | undefined
}

/**
 * Lets only platform operators through: the admin key, or a signed-in user with the `operator`
 * role. Anyone else is refused, with the status telling a client what to do:
 *  - 401: no credential, or a session that is not valid (sign in)
 *  - 403: a credential that is not an operator's (a tenant manager, a tenant API key, a wrong key)
 *
 * Explicit `Authorization` credentials win over a cookie. A session is cookie-based, so state-changing
 * requests made with one also have to pass the CSRF check; a Bearer credential is not sent by a
 * browser on its own and needs none.
 */
export function createOperatorGuard(deps: OperatorGuardDeps): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    const authHeader = c.req.header('Authorization')
    if (authHeader) {
      if (isAdminKeyHeader(authHeader, deps.adminApiKey)) {
        c.set('principal', { kind: 'adminKey' })
        return next()
      }
      return c.json({ error: 'FORBIDDEN', message: 'Operator credentials required' }, 403)
    }

    const token = readSessionToken(c)
    const resolved = token ? await deps.sessions.resolve(token) : null
    if (!resolved) {
      return c.json({ error: 'UNAUTHENTICATED', message: 'Sign in as an operator, or send the admin key' }, 401, {
        'WWW-Authenticate': 'Bearer realm="nexus-workflow"',
      })
    }
    if (!isCsrfSafe(c, deps.publicOrigin)) return c.json(CSRF_FAILURE, 403)

    const principal: Principal = {
      kind: 'user',
      user: resolved.user,
      memberships: await deps.users.listMemberships(resolved.user.id),
    }
    if (!isOperator(principal)) return c.json({ error: 'FORBIDDEN', message: 'Operator role required' }, 403)

    c.set('principal', principal)
    return next()
  }
}
