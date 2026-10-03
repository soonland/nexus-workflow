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

export type UserStatus = 'active' | 'disabled'
export type MembershipRole = 'operator' | 'tenant_manager'

export interface User {
  id: string
  email: string
  name: string
  status: UserStatus
  createdAt: string
  lastLoginAt: string | null
  /** False until the person has accepted their invitation. */
  hasPassword: boolean
}

export interface Membership {
  id: string
  userId: string
  role: MembershipRole
  /** Null for operators, who are not tied to a tenant. */
  tenantId: string | null
  createdAt: string
}

export interface UserWithMemberships extends User {
  memberships: Membership[]
}

/** What to grant: operators have no tenant, tenant managers need one. */
export type MembershipRequest = { role: 'operator' } | { role: 'tenant_manager'; tenantId: string }

export interface SessionInfo {
  user: User
  memberships: Membership[]
}

export interface Invite {
  token: string
  /** Where the invitation page lives, relative to this site. */
  path: string
  /** Absolute link; present only when the server knows its public address (PUBLIC_ORIGIN). */
  url?: string
  expiresAt: string
}

export interface InviteInfo {
  email: string
  name: string
  expiresAt: string
}

export interface DefinitionSummary {
  id: string
  name?: string
  version?: number
  isDeployable?: boolean
}
