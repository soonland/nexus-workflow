import { Hono } from 'hono'
import { normalizeEmail } from '../auth/email.js'
import type { LoginThrottle } from '../auth/LoginThrottle.js'
import type { PasswordHasher } from '../auth/PasswordHasher.js'
import { clearSessionCookie, clientIp, readSessionToken, setSessionCookie } from '../auth/sessionCookie.js'
import type { SessionStore } from '../db/SessionStore.js'
import type { UserStore } from '../db/UserStore.js'
import { csrfGuard } from './middleware/csrf.js'

export interface AuthRouterDeps {
  users: UserStore
  sessions: SessionStore
  hasher: PasswordHasher
  /** Failures per account (an unknown email counts like any other). */
  accountThrottle: LoginThrottle
  /** Failures per client address. */
  ipThrottle: LoginThrottle
  /** Lifetime of the cookie; matches the sessions' absolute maximum. */
  sessionMaxAgeSeconds: number
  /** Believe X-Forwarded-For / X-Forwarded-Proto (only behind a proxy you control). */
  trustProxy: boolean
  /** The origin the console is served from; defaults to the request's own. */
  publicOrigin?: string | undefined
}

const INVALID_CREDENTIALS = { error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } as const

/** Sign-in for people: `POST /login`, `POST /logout` and `GET /me`, with a session cookie. */
export function createAuthRouter(deps: AuthRouterDeps): Hono {
  const { users, sessions, hasher, accountThrottle, ipThrottle, trustProxy } = deps
  const app = new Hono()

  // Nothing here may be cached: responses are about one person's session
  app.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store')
  })
  app.use('*', csrfGuard({ publicOrigin: deps.publicOrigin }))

  app.post('/login', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid JSON body' }, 400)
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return c.json({ error: 'VALIDATION_ERROR', message: 'Body must be a JSON object' }, 400)
    }
    const { email, password } = body as Record<string, unknown>
    if (typeof email !== 'string' || typeof password !== 'string') {
      return c.json({ error: 'VALIDATION_ERROR', message: '"email" and "password" must be strings' }, 400)
    }

    // Throttle by whatever was typed, valid email or not, so unknown accounts behave like real ones
    const accountKey = `account:${normalizeEmail(email) ?? email.trim().toLowerCase().slice(0, 254)}`
    const ip = clientIp(c, trustProxy)
    const ipKey = `ip:${ip}`

    const blocked = [accountThrottle.check(accountKey), ipThrottle.check(ipKey)].filter(
      (r): r is { allowed: false; retryAfterSeconds: number } => !r.allowed,
    )
    if (blocked.length > 0) {
      const retryAfter = Math.max(...blocked.map((r) => r.retryAfterSeconds))
      c.header('Retry-After', String(retryAfter))
      return c.json({ error: 'TOO_MANY_ATTEMPTS', message: 'Too many sign-in attempts. Try again later.' }, 429)
    }

    // verify() does the same work whether or not the account (or its password) exists
    const credentials = await users.findCredentialsByEmail(email)
    const passwordOk = await hasher.verify(password, credentials?.passwordHash ?? null)

    if (!credentials || !passwordOk || credentials.status !== 'active') {
      accountThrottle.recordFailure(accountKey)
      ipThrottle.recordFailure(ipKey)
      return c.json(INVALID_CREDENTIALS, 401)
    }

    accountThrottle.recordSuccess(accountKey)

    // A new session for every sign-in; the one the browser arrived with (if any) is retired
    const previous = readSessionToken(c)
    if (previous) await sessions.destroy(previous)
    const { token } = await sessions.create(credentials.id, { userAgent: c.req.header('user-agent') ?? null, ip })
    await users.recordLogin(credentials.id)
    setSessionCookie(c, token, deps.sessionMaxAgeSeconds, trustProxy)

    const user = await users.findById(credentials.id)
    return c.json({ user, memberships: await users.listMemberships(credentials.id) })
  })

  app.post('/logout', async (c) => {
    const token = readSessionToken(c)
    if (token) await sessions.destroy(token)
    clearSessionCookie(c, trustProxy)
    return c.json({ success: true })
  })

  app.get('/me', async (c) => {
    const token = readSessionToken(c)
    const resolved = token ? await sessions.resolve(token) : null
    if (!resolved) return c.json({ error: 'UNAUTHENTICATED', message: 'Not signed in' }, 401)
    return c.json({ user: resolved.user, memberships: await users.listMemberships(resolved.user.id) })
  })

  return app
}
