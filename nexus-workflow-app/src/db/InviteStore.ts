import { createHmac, randomBytes } from 'node:crypto'
import type postgres from 'postgres'
import type { User } from './UserStore.js'

export interface InviteStoreOptions {
  /** Keys the hash that is stored in place of the token (use API_KEY_HMAC_SECRET). */
  hmacSecret: string
  /** How long an invite stays valid. */
  ttlMs: number
}

/** What a person sees before choosing a password. Nothing in it is secret. */
export interface InviteInfo {
  email: string
  name: string
  expiresAt: Date
}

// Tokens are 32 random bytes in base64url: exactly 43 characters.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

/**
 * One-time invite links. An invite lets a person set their own password (there is no email
 * server, so an operator hands them the link). Only an HMAC of the token is stored; an invite
 * works once, expires, and is replaced when a new one is issued for the same person.
 */
export class InviteStore {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly options: InviteStoreOptions,
  ) {}

  private hash(token: string): string {
    return createHmac('sha256', this.options.hmacSecret).update(token).digest('hex')
  }

  /**
   * Issues an invite for the user and invalidates their earlier unused ones. The token is
   * returned once and never stored.
   */
  async create(userId: string, createdBy: string | null): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url')
    return this.sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as postgres.Sql
      await tx`DELETE FROM public.invites WHERE user_id = ${userId} AND used_at IS NULL`
      const rows = await tx<{ expiresAt: Date }[]>`
        INSERT INTO public.invites (id, user_id, token_hash, created_by, expires_at)
        VALUES (
          ${randomBytes(16).toString('hex')}, ${userId}, ${this.hash(token)}, ${createdBy},
          now() + make_interval(secs => ${this.options.ttlMs / 1000})
        )
        RETURNING expires_at AS "expiresAt"
      `
      const created = rows[0]
      if (!created) throw new Error('Unexpected: INSERT INTO invites returned no rows')
      return { token, expiresAt: created.expiresAt }
    })
  }

  /** Who a still-usable invite is for, or null (unknown, malformed, used, expired, user disabled). */
  async inspect(token: string): Promise<InviteInfo | null> {
    if (!TOKEN_PATTERN.test(token)) return null
    const rows = await this.sql<InviteInfo[]>`
      SELECT u.email, u.name, i.expires_at AS "expiresAt"
      FROM public.invites i
      JOIN public.users u ON u.id = i.user_id
      WHERE i.token_hash = ${this.hash(token)}
        AND i.used_at IS NULL
        AND i.expires_at > now()
        AND u.status = 'active'
    `
    return rows[0] ?? null
  }

  /**
   * Uses the invite up and sets the person's password (which also ends their other sessions).
   * Returns the user, or null if the invite cannot be used. Atomic: of several simultaneous
   * attempts with the same token exactly one succeeds.
   */
  async accept(token: string, passwordHash: string): Promise<User | null> {
    if (!TOKEN_PATTERN.test(token)) return null
    return this.sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as postgres.Sql
      const used = await tx<{ userId: string }[]>`
        UPDATE public.invites i SET used_at = now()
        FROM public.users u
        WHERE i.token_hash = ${this.hash(token)}
          AND i.used_at IS NULL
          AND i.expires_at > now()
          AND u.id = i.user_id
          AND u.status = 'active'
        RETURNING i.user_id AS "userId"
      `
      const userId = used[0]?.userId
      if (!userId) return null

      await tx`UPDATE public.users SET password_hash = ${passwordHash} WHERE id = ${userId}`
      await tx`DELETE FROM public.sessions WHERE user_id = ${userId}`
      const users = await tx<User[]>`
        SELECT id, email, name, status, created_at AS "createdAt", last_login_at AS "lastLoginAt",
               (password_hash IS NOT NULL) AS "hasPassword"
        FROM public.users WHERE id = ${userId}
      `
      return users[0] ?? null
    })
  }
}
