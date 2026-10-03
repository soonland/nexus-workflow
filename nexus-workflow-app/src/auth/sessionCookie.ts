import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { getConnInfo } from '@hono/node-server/conninfo'

export const SESSION_COOKIE = 'nexus_session'

/** True when the browser reached us over HTTPS (directly, or via a proxy we are told to trust). */
export function isSecureRequest(c: Context, trustProxy: boolean): boolean {
  if (new URL(c.req.url).protocol === 'https:') return true
  return trustProxy && c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() === 'https'
}

/**
 * The cookie is HttpOnly (scripts cannot read it), SameSite=Strict (never sent on cross-site
 * requests) and Secure whenever the connection is HTTPS.
 */
export function setSessionCookie(c: Context, token: string, maxAgeSeconds: number, trustProxy: boolean): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: isSecureRequest(c, trustProxy),
    path: '/',
    maxAge: maxAgeSeconds,
  })
}

export function clearSessionCookie(c: Context, trustProxy: boolean): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: isSecureRequest(c, trustProxy) })
}

export function readSessionToken(c: Context): string | null {
  return getCookie(c, SESSION_COOKIE) ?? null
}

/**
 * The caller's address, for throttling and for the session record.
 *
 * `trustedProxies` is how many proxies of yours sit in front of this server (0 = none, and the
 * X-Forwarded-For header, which anyone can send, is ignored). Each trusted proxy appends the
 * address it received the request from, so the client is the entry `trustedProxies` places from
 * the end: with one proxy that is the last entry, behind a CDN plus a load balancer it is the
 * second to last. Anything earlier is whatever the client claimed. Returns "unknown" when the
 * chain is shorter than that (see below).
 */
export function clientIp(c: Context, trustedProxies: number): string {
  if (trustedProxies > 0) {
    const entries = (c.req.header('x-forwarded-for') ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
    const client = entries[entries.length - trustedProxies]
    if (client) return client
    // Fewer entries than trusted proxies: TRUST_PROXY is set higher than the real number of proxies,
    // or the app was reached without going through them. The socket is then a proxy (or an unknown
    // caller), and keying anything on it would put every client into one shared bucket, so report
    // "unknown" and let the caller skip its per-address limits.
    warnForwardedChainTooShort(trustedProxies)
    return 'unknown'
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown' // not running under the Node server (tests)
  }
}

let warnedChainTooShort = false

function warnForwardedChainTooShort(trustedProxies: number): void {
  if (warnedChainTooShort) return
  warnedChainTooShort = true
  console.warn(
    `[auth] X-Forwarded-For has fewer than ${trustedProxies} entries although TRUST_PROXY=${trustedProxies}: ` +
      'either TRUST_PROXY is higher than the number of proxies in front of this server, or requests reach it ' +
      'without going through them. Per-address limits are skipped for those requests.',
  )
}
