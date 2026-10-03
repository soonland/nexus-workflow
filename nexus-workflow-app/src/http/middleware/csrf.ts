import type { MiddlewareHandler } from 'hono'

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
 * Protects cookie-authenticated requests against cross-site request forgery. A state-changing
 * request must carry the custom `X-Nexus-Console: 1` header, which a page on another site cannot
 * add (this API sends no CORS headers, so the browser blocks the preflight), and, if the browser
 * sent an `Origin`, it must be ours. The opaque origin `null` is refused. Requests without an
 * `Origin` (scripts, curl) are accepted on the strength of the header alone.
 */
export function csrfGuard(options: CsrfGuardOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next()

    const expectedOrigin = options.publicOrigin ?? new URL(c.req.url).origin
    const origin = c.req.header('origin')
    const headerOk = c.req.header(CSRF_HEADER) === '1'
    const originOk = origin === undefined || origin === expectedOrigin

    if (!headerOk || !originOk) {
      return c.json({ error: 'CSRF', message: 'Missing or invalid request origin' }, 403)
    }
    return next()
  }
}
