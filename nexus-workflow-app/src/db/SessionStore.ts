import { createHmac, randomBytes } from 'node:crypto'
import type postgres from 'postgres'
import type { User } from './UserStore.js'

export interface SessionStoreOptions {
  /**
   * Keys the hash that is stored in place of the token (use API_KEY_HMAC_SECRET, required in
   * production). Tokens are 256 random bits, so they cannot be guessed or recovered from their
   * hash whatever the key is; the secret is defence in depth, and an empty one (development only)
   * does not weaken the sessions.
   */
  hmacSecret: string
  /** A session unused for this long ends. */
  idleMs: number
  /** A session ends this long after it was created, however busy it was. */
  maxMs: number
}

export interface SessionMeta {
  userAgent?: string | null
  ip?: string | null
}

export interface ResolvedSession {
  user: User
  expiresAt: Date
}

// Tokens are 32 random bytes in base64url: exactly 43 characters.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const MAX_USER_AGENT_LENGTH = 512
const MAX_IP_LENGTH = 64
// `last_seen_at` is only rewritten when it is older than this, so a busy session is not a write per request.
const TOUCH_AFTER_SECONDS = 60

/**
 * Server-side sessions. The browser holds a random token (in a cookie); the database holds only
 * an HMAC of it, so a leaked database cannot be used to sign in. A session has a sliding idle
 * expiry and an absolute maximum lifetime, and belongs to an active user.
 */
export class SessionStore {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly options: SessionStoreOptions,
  ) {}

  private hash(token: string): string {
    return createHmac('sha256', this.options.hmacSecret).update(token).digest('hex')
  }

  /** Starts a session for the user. The returned token is the only copy: it is never stored. */
  async create(userId: string, meta: SessionMeta): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url')
    const rows = await this.sql<{ expiresAt: Date }[]>`
      INSERT INTO public.sessions (token_hash, user_id, expires_at, user_agent, ip)
      VALUES (
        ${this.hash(token)},
        ${userId},
        now() + make_interval(secs => ${this.options.maxMs / 1000}),
        ${meta.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null},
        ${meta.ip?.slice(0, MAX_IP_LENGTH) ?? null}
      )
      RETURNING expires_at AS "expiresAt"
    `
    const created = rows[0]
    if (!created) throw new Error('Unexpected: INSERT INTO sessions returned no rows')
    return { token, expiresAt: created.expiresAt }
  }

  /** The user a token belongs to, or null if it is unknown, expired, idle for too long or the user is disabled. */
  async resolve(token: string): Promise<ResolvedSession | null> {
    if (!TOKEN_PATTERN.test(token)) return null
    const tokenHash = this.hash(token)

    const rows = await this.sql<(User & { sessionExpiresAt: Date; secondsSinceSeen: number })[]>`
      SELECT
        u.id, u.email, u.name, u.status,
        u.created_at AS "createdAt",
        u.last_login_at AS "lastLoginAt",
        (u.password_hash IS NOT NULL) AS "hasPassword",
        s.expires_at AS "sessionExpiresAt",
        extract(epoch FROM now() - s.last_seen_at)::float AS "secondsSinceSeen"
      FROM public.sessions s
      JOIN public.users u ON u.id = s.user_id
      WHERE s.token_hash = ${tokenHash}
        AND u.status = 'active'
        AND s.expires_at > now()
        AND s.last_seen_at > now() - make_interval(secs => ${this.options.idleMs / 1000})
    `
    const row = rows[0]
    if (!row) return null

    if (row.secondsSinceSeen > TOUCH_AFTER_SECONDS) {
      await this.sql`UPDATE public.sessions SET last_seen_at = now() WHERE token_hash = ${tokenHash}`
    }

    const { sessionExpiresAt, secondsSinceSeen: _unused, ...user } = row
    return { user, expiresAt: sessionExpiresAt }
  }

  /** Ends one session. Quiet if the token is unknown. */
  async destroy(token: string): Promise<void> {
    if (!TOKEN_PATTERN.test(token)) return
    await this.sql`DELETE FROM public.sessions WHERE token_hash = ${this.hash(token)}`
  }

  async destroyAllForUser(userId: string): Promise<void> {
    await this.sql`DELETE FROM public.sessions WHERE user_id = ${userId}`
  }

  /** Deletes sessions past their absolute expiry or idle for too long. Returns how many. */
  async purgeExpired(): Promise<number> {
    const rows = await this.sql`
      DELETE FROM public.sessions
      WHERE expires_at <= now()
         OR last_seen_at <= now() - make_interval(secs => ${this.options.idleMs / 1000})
      RETURNING token_hash
    `
    return rows.length
  }
}
