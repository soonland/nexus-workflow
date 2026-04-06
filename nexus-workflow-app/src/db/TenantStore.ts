import { createHmac, randomBytes } from 'node:crypto'
import type postgres from 'postgres'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Tenant {
  id: string
  name: string
  status: 'active' | 'suspended'
  createdAt: Date
}

export interface ApiKey {
  id: string
  tenantId: string
  name: string
  keyHash: string
  createdAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
}

/** Public-facing API key shape — `keyHash` is intentionally omitted. */
export type ApiKeyPublic = Omit<ApiKey, 'keyHash'>

// ─── TenantStore ──────────────────────────────────────────────────────────────

export class TenantStore {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly hmacSecret: string,
  ) {}

  // ─── Tenants ───────────────────────────────────────────────────────────────

  async createTenant(id: string, name: string): Promise<Tenant> {
    const rows = await this.sql<Tenant[]>`
      INSERT INTO public.tenants (id, name, status)
      VALUES (${id}, ${name}, 'active')
      RETURNING id, name, status, created_at AS "createdAt"
    `
    const tenant = rows[0]
    if (!tenant) throw new Error(`Unexpected: INSERT INTO tenants returned no rows for id '${id}'`)
    return tenant
  }

  async getTenant(id: string): Promise<Tenant | null> {
    const rows = await this.sql<Tenant[]>`
      SELECT id, name, status, created_at AS "createdAt"
      FROM public.tenants
      WHERE id = ${id}
    `
    return rows[0] ?? null
  }

  /** Deletes the tenant row. Used to clean up after a failed schema provisioning. */
  async deleteTenant(id: string): Promise<void> {
    await this.sql`DELETE FROM public.tenants WHERE id = ${id}`
  }

  // ─── API Keys ──────────────────────────────────────────────────────────────

  /**
   * Creates a new API key for the tenant. Returns the plaintext key — this is
   * the only time it will ever be available; it is not stored.
   */
  async createApiKey(
    tenantId: string,
    name: string,
  ): Promise<{ key: ApiKeyPublic; plaintext: string }> {
    const plaintext = randomBytes(32).toString('hex')
    const keyHash = createHmac('sha256', this.hmacSecret).update(plaintext).digest('hex')
    const id = randomBytes(16).toString('hex')

    const rows = await this.sql<ApiKeyPublic[]>`
      INSERT INTO public.api_keys (id, tenant_id, name, key_hash)
      VALUES (${id}, ${tenantId}, ${name}, ${keyHash})
      RETURNING
        id,
        tenant_id AS "tenantId",
        name,
        created_at AS "createdAt",
        last_used_at AS "lastUsedAt",
        revoked_at AS "revokedAt"
    `

    const key = rows[0]
    if (!key) throw new Error('Unexpected: INSERT INTO api_keys returned no rows')
    return { key, plaintext }
  }

  /**
   * Returns all keys for the tenant — including revoked ones — ordered by
   * creation date. Callers can filter by `revokedAt !== null` if they only
   * want active keys. Admin visibility into revoked keys is intentional.
   */
  async listApiKeys(tenantId: string): Promise<ApiKeyPublic[]> {
    return this.sql<ApiKeyPublic[]>`
      SELECT
        id,
        tenant_id AS "tenantId",
        name,
        created_at AS "createdAt",
        last_used_at AS "lastUsedAt",
        revoked_at AS "revokedAt"
      FROM public.api_keys
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at ASC
    `
  }

  async revokeApiKey(tenantId: string, keyId: string): Promise<boolean> {
    const rows = await this.sql`
      UPDATE public.api_keys
      SET revoked_at = now()
      WHERE id = ${keyId}
        AND tenant_id = ${tenantId}
        AND revoked_at IS NULL
      RETURNING id
    `
    return rows.length > 0
  }
}
