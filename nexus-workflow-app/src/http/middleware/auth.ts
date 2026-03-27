import { timingSafeEqual } from 'node:crypto'
import type { Context, Next } from 'hono'

/**
 * Hono middleware that enforces API key authentication.
 *
 * Reads the `Authorization: Bearer <key>` header and returns 401 if the key
 * is missing or not in the provided list of valid keys.
 *
 * The `/health` path is always bypassed so liveness probes work without credentials.
 */

function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export function createAuthMiddleware(apiKeys: string[]) {
  return async function authMiddleware(c: Context, next: Next) {
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
    if (scheme !== 'Bearer' || !key || !apiKeys.some(k => safeEq(k, key))) {
      return c.json({ error: 'unauthorized' }, 401, {
        'WWW-Authenticate': 'Bearer realm="nexus-workflow"',
      })
    }

    return next()
  }
}
