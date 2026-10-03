import type { MiddlewareHandler } from 'hono'
import { isAdminKeyHeader } from '../../auth/adminKey.js'
import { isOperator, managedTenantIds, type Principal } from '../../auth/principal.js'
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
 * Builds a guard that admits the callers `allow` accepts. Anyone else is refused, with the status
 * telling a client what to do:
 *  - 401: no credential, or a session that is not valid (sign in)
 *  - 403: a credential that is not allowed (a tenant API key, a wrong key, the wrong role)
 *
 * Explicit `Authorization` credentials win over a cookie; the only one accepted here is the admin
 * key. A session is cookie-based, so state-changing requests made with one also have to pass the
 * CSRF check; a Bearer credential is not sent by a browser on its own and needs none.
 */
function createGuard(
  deps: OperatorGuardDeps,
  allow: (principal: Principal) => boolean,
  forbidden: { bearer: string; session: string },
): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    const authHeader = c.req.header('Authorization')
    if (authHeader) {
      if (isAdminKeyHeader(authHeader, deps.adminApiKey)) {
        c.set('principal', { kind: 'adminKey' })
        return next()
      }
      return c.json({ error: 'FORBIDDEN', message: forbidden.bearer }, 403)
    }

    const token = readSessionToken(c)
    const resolved = token ? await deps.sessions.resolve(token) : null
    if (!resolved) {
      return c.json({ error: 'UNAUTHENTICATED', message: 'Sign in, or send the admin key' }, 401, {
        'WWW-Authenticate': 'Bearer realm="nexus-workflow"',
      })
    }
    if (!isCsrfSafe(c, deps.publicOrigin)) return c.json(CSRF_FAILURE, 403)

    const principal: Principal = {
      kind: 'user',
      user: resolved.user,
      memberships: await deps.users.listMemberships(resolved.user.id),
    }
    if (!allow(principal)) return c.json({ error: 'FORBIDDEN', message: forbidden.session }, 403)

    c.set('principal', principal)
    return next()
  }
}

/** Platform operators only: the admin key, or a signed-in user with the `operator` role. */
export function createOperatorGuard(deps: OperatorGuardDeps): MiddlewareHandler<{ Variables: AppVariables }> {
  return createGuard(deps, isOperator, {
    bearer: 'Operator credentials required',
    session: 'Operator role required',
  })
}

/**
 * Whoever may administer people: operators, and tenant managers (who are then limited to their
 * own tenants by UserAdmin). The admin key counts as an operator.
 */
export function createPeopleAdminGuard(deps: OperatorGuardDeps): MiddlewareHandler<{ Variables: AppVariables }> {
  return createGuard(deps, (principal) => isOperator(principal) || managedTenantIds(principal).length > 0, {
    bearer: 'Operator credentials required',
    session: 'Operator or tenant manager role required',
  })
}
