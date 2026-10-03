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
  /**
   * Failures for one account from one client address. This is the strict lock: whoever is
   * guessing is locked out, while the real owner, signing in from somewhere else, is not.
   */
  accountIpThrottle: LoginThrottle
  /**
   * Failures for one account from anywhere. A higher limit than the pair above: it only trips
   * when guessing is spread over many addresses. (An unknown email counts like any other.)
   */
  accountThrottle: LoginThrottle
  /** Failures from one client address, against any accounts. */
  ipThrottle: LoginThrottle
  /** Lifetime of the cookie; matches the sessions' absolute maximum. */
  sessionMaxAgeSeconds: number
  /** How many proxies of yours are in front of this server (0 = none). Decides whether
   *  X-Forwarded-For / X-Forwarded-Proto are believed and which entry is the client. */
  trustedProxies: number
  /** The origin the console is served from; defaults to the request's own. */
  publicOrigin?: string | undefined
}

const INVALID_CREDENTIALS = { error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } as const

/** Sign-in for people: `POST /login`, `POST /logout` and `GET /me`, with a session cookie. */
export function createAuthRouter(deps: AuthRouterDeps): Hono {
  const { users, sessions, hasher, accountIpThrottle, accountThrottle, ipThrottle, trustedProxies } = deps
  const trustProxy = trustedProxies > 0
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
    const ip = clientIp(c, trustedProxies)
    const throttles: Array<{ throttle: LoginThrottle; key: string }> = [
      { throttle: accountIpThrottle, key: `${accountKey}|${ip}` },
      { throttle: accountThrottle, key: accountKey },
    ]
    // Without a known address there is nothing to key a per-address limit on, and one shared
    // "unknown" bucket would let a single client lock everyone else out.
    if (ip !== 'unknown') throttles.push({ throttle: ipThrottle, key: `ip:${ip}` })

    // 1. Refuse locked keys without recording anything: a locked-out guesser must not be able to
    //    push the *other* counters (the account's, the address's) over their limits by hammering.
    const blocked = throttles
      .map(({ throttle, key }) => throttle.check(key))
      .filter((r): r is { allowed: false; retryAfterSeconds: number } => !r.allowed)
    if (blocked.length > 0) {
      c.header('Retry-After', String(Math.max(...blocked.map((r) => r.retryAfterSeconds))))
      return c.json({ error: 'TOO_MANY_ATTEMPTS', message: 'Too many sign-in attempts. Try again later.' }, 429)
    }

    // 2. Reserve capacity for this attempt *now*. Checking the password is slow, so looking only at
    //    recorded failures would let a burst of parallel requests all pass step 1 before any of
    //    them had failed. There is no await between steps 1 and 2, so no other request can slip
    //    in between them.
    const attempts = throttles.flatMap(({ throttle, key }) => {
      const attempt = throttle.begin(key)
      return attempt.allowed ? [attempt] : []
    })
    const releaseAll = () => attempts.forEach((attempt) => attempt.release())

    let credentials
    let passwordOk: boolean
    try {
      credentials = await users.findCredentialsByEmail(email)
      // verify() does the same work whether or not the account (or its password) exists
      passwordOk = await hasher.verify(password, credentials?.passwordHash ?? null)
    } catch (err) {
      releaseAll() // our own failure (say, the database) is not a wrong guess
      throw err
    }

    if (!credentials || !passwordOk || credentials.status !== 'active') {
      attempts.forEach((attempt) => attempt.fail())
      return c.json(INVALID_CREDENTIALS, 401)
    }

    // A success is not a failure. It also forgives what this address got wrong earlier; the
    // account-wide and per-address counts keep their earlier failures, so one success cannot
    // reset the guard against guessing spread over many addresses.
    releaseAll()
    accountIpThrottle.recordSuccess(`${accountKey}|${ip}`)

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
