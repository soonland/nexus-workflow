import type { Context, MiddlewareHandler } from 'hono'

/** Header every state-changing request to the auth endpoints must carry (any value is not enough: "1"). */
export const CSRF_HEADER = 'x-nexus-console'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export interface CsrfGuardOptions {
  /**
   * The origin the console is served from (for example `https://workflow.example.com`).
   * Defaults to the origin of the request URL, which is wrong behind a proxy that rewrites the host.
   */
  publicOrigin?: string | undefined
}

/**
 * Whether a request passes the cross-site request forgery check. A state-changing request must
 * carry the custom `X-Nexus-Console: 1` header, which a page on another site cannot add (this API
 * sends no CORS headers, so the browser blocks the preflight), and, if the browser sent an
 * `Origin`, it must be ours. The opaque origin `null` is refused. Requests without an `Origin`
 * (scripts, curl) pass on the strength of the header alone. Safe methods always pass.
 */
export function isCsrfSafe(c: Context, publicOrigin?: string): boolean {
  if (SAFE_METHODS.has(c.req.method)) return true
  const expectedOrigin = publicOrigin ?? new URL(c.req.url).origin
  const origin = c.req.header('origin')
  return c.req.header(CSRF_HEADER) === '1' && (origin === undefined || origin === expectedOrigin)
}

export const CSRF_FAILURE = { error: 'CSRF', message: 'Missing or invalid request origin' } as const

/** Middleware form of `isCsrfSafe`, for routes that are always reached with a cookie. */
export function csrfGuard(options: CsrfGuardOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    if (!isCsrfSafe(c, options.publicOrigin)) return c.json(CSRF_FAILURE, 403)
    return next()
  }
}
