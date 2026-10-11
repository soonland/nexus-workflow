import type { MiddlewareHandler } from 'hono'
import { keyMayCall } from '../../auth/keyPermissions.js'
import type { AppVariables } from './auth.js'

/**
 * Holds a tenant API key to what its role allows. Place it after the authentication middleware, which
 * sets the principal. People (who are tenant managers) and `tenant_manager` keys pass; a `service`
 * key passes only on the runtime routes (see `keyPermissions`).
 */
export function createKeyRoleMiddleware(): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (c, next) => {
    const principal = c.get('principal')
    if (principal?.kind === 'apiKey' && !keyMayCall(principal.role, c.req.method, c.req.path)) {
      return c.json(
        {
          error: 'FORBIDDEN',
          message: `This API key has the role "${principal.role}", which cannot ${c.req.method} ${c.req.path}. Ask a tenant manager or an operator for a key with the "tenant_manager" role.`,
        },
        403,
      )
    }
    return next()
  }
}
