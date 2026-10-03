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
 * The caller's address, for throttling and for the session record. Behind a proxy we are told
 * to trust, the proxy appends the real client address, so the last X-Forwarded-For entry is the
 * one to use (earlier entries are whatever the client claimed).
 */
export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim()
    if (forwarded) return forwarded
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown' // not running under the Node server (tests)
  }
}
