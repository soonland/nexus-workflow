import type { Context, Next } from 'hono'

/**
 * Hono middleware that enforces API key authentication.
 *
 * Reads the `Authorization: Bearer <key>` header and returns 401 if the key
 * is missing or not in the provided list of valid keys.
 *
 * The `/health` path is always bypassed so liveness probes work without credentials.
 */
export function createAuthMiddleware(apiKeys: string[]) {
  return async function authMiddleware(c: Context, next: Next) {
    if (c.req.path === '/health') {
      return next()
    }

    const authHeader = c.req.header('Authorization')
    if (!authHeader) {
      return c.json({ error: 'unauthorized' }, 401)
    }

    const [scheme, key] = authHeader.split(' ')
    if (scheme !== 'Bearer' || !key || !apiKeys.includes(key)) {
      return c.json({ error: 'unauthorized' }, 401)
    }

    return next()
  }
}
