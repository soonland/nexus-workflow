import { createHmac, randomBytes } from 'node:crypto'
import type postgres from 'postgres'
import { atomically, type Within } from './atomically.js'

/** Every operator key starts with this, so one is recognisable at a glance and never mistaken for a tenant key. */
export const OPERATOR_KEY_PREFIX = 'nxop_'

export interface OperatorKey {
  id: string
  name: string
  /** The person who created it; null for the admin key, or once that person is gone. */
  createdBy: string | null
  createdAt: Date
  lastUsedAt: Date | null
  /** After this moment the key is refused. Null: it does not expire. */
  expiresAt: Date | null
  revokedAt: Date | null
}

const COLUMNS = `
  id, name,
  created_by AS "createdBy",
  created_at AS "createdAt",
  last_used_at AS "lastUsedAt",
  expires_at AS "expiresAt",
  revoked_at AS "revokedAt"`

/** Keys for programs that administer the platform. Only a hash is stored. */
export class OperatorKeyStore {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly hmacSecret: string,
  ) {}

  private hash(plaintext: string): string {
    return createHmac('sha256', this.hmacSecret).update(plaintext).digest('hex')
  }

  /** Creates a key. The plaintext is returned once and is not stored. `within` runs in the same transaction. */
  async create(
    name: string,
    options: { createdBy?: string | null; expiresAt?: Date | null } = {},
    within?: Within<{ key: OperatorKey; plaintext: string }>,
  ): Promise<{ key: OperatorKey; plaintext: string }> {
    const plaintext = OPERATOR_KEY_PREFIX + randomBytes(32).toString('hex')
    const id = randomBytes(16).toString('hex')
    return atomically(
      this.sql,
      async (db) => {
        const rows = await db<OperatorKey[]>`
          INSERT INTO public.operator_keys (id, name, key_hash, created_by, expires_at)
          VALUES (${id}, ${name}, ${this.hash(plaintext)}, ${options.createdBy ?? null}, ${options.expiresAt ?? null})
          RETURNING ${db.unsafe(COLUMNS)}
        `
        const key = rows[0]
        if (!key) throw new Error('Unexpected: INSERT INTO operator_keys returned no rows')
        return { key, plaintext }
      },
      within,
    )
  }

  /** All keys, revoked and expired ones included, newest first. */
  async list(): Promise<OperatorKey[]> {
    return this.sql<OperatorKey[]>`SELECT ${this.sql.unsafe(COLUMNS)} FROM public.operator_keys ORDER BY created_at DESC, id`
  }

  /**
   * Revokes a key and returns it (as it is now), in one statement. Null if there is no such key or it
   * was already revoked, so of two simultaneous revokes exactly one gets the key back.
   * `within` runs in the same transaction, only for the request that revoked it.
   */
  async revoke(id: string, within?: Within<OperatorKey>): Promise<OperatorKey | null> {
    return atomically(
      this.sql,
      async (db) => {
        const rows = await db<OperatorKey[]>`
          UPDATE public.operator_keys SET revoked_at = now()
          WHERE id = ${id} AND revoked_at IS NULL
          RETURNING ${db.unsafe(COLUMNS)}
        `
        return rows[0] ?? null
      },
      within,
    )
  }

  /**
   * The key behind this secret if it can be used now (not revoked, not expired), else null. A key
   * that is used has its `last_used_at` updated (without making the caller wait for it).
   */
  async authenticate(plaintext: string): Promise<OperatorKey | null> {
    if (!plaintext.startsWith(OPERATOR_KEY_PREFIX)) return null // not one of ours: no lookup at all
    const rows = await this.sql<OperatorKey[]>`
      SELECT ${this.sql.unsafe(COLUMNS)} FROM public.operator_keys
      WHERE key_hash = ${this.hash(plaintext)}
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1
    `
    const key = rows[0]
    if (!key) return null
    this.sql`UPDATE public.operator_keys SET last_used_at = now() WHERE id = ${key.id}`.then(
      () => undefined,
      (err: unknown) => console.warn('[operator-keys] failed to update last_used_at:', err),
    )
    return key
  }
}
