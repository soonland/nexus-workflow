import type { MiddlewareHandler } from 'hono'
import { isAdminKeyHeader } from '../../auth/adminKey.js'
import { isOperator, managedTenantIds, type Principal } from '../../auth/principal.js'
import { readSessionToken } from '../../auth/sessionCookie.js'
import type { OperatorKeyStore } from '../../db/OperatorKeyStore.js'
import type { SessionStore } from '../../db/SessionStore.js'
import type { UserStore } from '../../db/UserStore.js'
import type { AppVariables } from './auth.js'
import { CSRF_FAILURE, isCsrfSafe } from './csrf.js'

export interface OperatorGuardDeps {
  /** The platform admin key (ADMIN_API_KEY); a break-glass operator credential. */
  adminApiKey: string
  sessions: SessionStore
  users: UserStore
  /** Named operator keys. Without it only the admin key is accepted as a Bearer credential. */
  operatorKeys?: OperatorKeyStore
  /** The origin the console is served from, for the CSRF check on sessions. */
  publicOrigin?: string | undefined
}

/**
 * Builds a guard that admits the callers `allow` accepts. Anyone else is refused, with the status
 * telling a client what to do:
 *  - 401: no credential, or a session that is not valid (sign in)
 *  - 403: a credential that is not allowed (a tenant API key, a wrong key, the wrong role)
 *
 * Explicit `Authorization` credentials win over a cookie; the ones accepted here are the admin key
 * and an operator key (`nxop_...`, not revoked, not expired). A session is cookie-based, so state-changing requests made with one also have to pass the
 * CSRF check; a Bearer credential is not sent by a browser on its own and needs none.
 */
function createGuard(
  deps: OperatorGuardDeps,
  allow: (principal: Principal) => boolean,
  forbidden: { bearer: string; session: string; /** For a valid operator key that `allow` does not accept. */ operatorKey?: string },
): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    const authHeader = c.req.header('Authorization')
    if (authHeader) {
      let principal: Principal | null = null
      if (isAdminKeyHeader(authHeader, deps.adminApiKey)) {
        principal = { kind: 'adminKey' }
      } else {
        const [scheme, token] = authHeader.split(' ')
        const key = scheme === 'Bearer' && token && deps.operatorKeys ? await deps.operatorKeys.authenticate(token) : null
        if (key) principal = { kind: 'operatorKey', keyId: key.id, keyName: key.name }
      }
      if (!principal) return c.json({ error: 'FORBIDDEN', message: forbidden.bearer }, 403)
      if (!allow(principal)) {
        return c.json({ error: 'FORBIDDEN', message: principal.kind === 'operatorKey' ? (forbidden.operatorKey ?? forbidden.bearer) : forbidden.bearer }, 403)
      }
      c.set('principal', principal)
      return next()
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

/**
 * For managing operator keys: signed-in operators and the admin key, **not operator keys**. A key
 * that could create keys could make itself a replacement and survive being revoked.
 */
export function createOperatorKeyAdminGuard(deps: OperatorGuardDeps): MiddlewareHandler<{ Variables: AppVariables }> {
  return createGuard(deps, (principal) => isOperator(principal) && principal.kind !== 'operatorKey', {
    bearer: 'Operator credentials required',
    session: 'Operator role required',
    operatorKey: 'An operator key cannot manage operator keys: sign in as an operator, or use the admin key',
  })
}
