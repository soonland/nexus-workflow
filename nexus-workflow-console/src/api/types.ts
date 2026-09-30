export type TenantStatus = 'active' | 'suspended' | 'deleting'

export interface Tenant {
  id: string
  name: string
  status: TenantStatus
  createdAt: string
  /** Number of API keys that have not been revoked. */
  activeKeyCount: number
}

export interface ApiKey {
  id: string
  tenantId: string
  name: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export interface CreatedKey {
  key: ApiKey
  /** The key itself. The API returns it only once. */
  plaintext: string
}
