export type TenantStatus = 'active' | 'suspended' | 'deleting'

/** How busy a tenant is: numbers only, never what its workflows contain. */
export interface TenantCounts {
  instances: Record<'pending' | 'active' | 'suspended' | 'completed' | 'terminated', number>
  /** Tasks that are open or claimed. */
  pendingTasks: number
}

export interface Tenant {
  id: string
  name: string
  status: TenantStatus
  createdAt: string
  /** Number of API keys that have not been revoked. */
  activeKeyCount: number
  /** Null when it cannot be read (a tenant being deleted). Absent in answers that were not asked for it. */
  counts?: TenantCounts | null
}

/** What a tenant API key may do: `service` is the runtime API, `tenant_manager` everything in its tenant. */
export type KeyRole = 'service' | 'tenant_manager'

export interface ApiKey {
  id: string
  tenantId: string
  name: string
  role: KeyRole
  /** The person who created it, if known. */
  createdBy: string | null
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
  version: number
  name: string
  deployedAt: string
  isDeployable: boolean
}

export interface DeployResult {
  id: string
  version: number
  name: string
  /** Things the parser noticed that do not stop the deploy. */
  validationWarnings: Array<string | { message?: string }>
}

export type InstanceStatus = 'pending' | 'active' | 'suspended' | 'completed' | 'terminated'
export const INSTANCE_STATUSES: InstanceStatus[] = ['pending', 'active', 'suspended', 'completed', 'terminated']

export interface InstanceSummary {
  id: string
  definitionId: string
  definitionVersion: number
  status: InstanceStatus
  correlationKey?: string
  businessKey?: string
  startedAt: string
  completedAt?: string
}

export interface Paged<T> {
  items: T[]
  total: number
  /** Zero-based. */
  page: number
  pageSize: number
}

export type TaskStatus = 'open' | 'claimed' | 'completed' | 'cancelled'
export const TASK_STATUSES: TaskStatus[] = ['open', 'claimed', 'completed', 'cancelled']

export interface UserTask {
  id: string
  instanceId: string
  name: string
  description?: string
  assignee?: string
  candidateGroups?: string[]
  dueDate?: string
  priority: number
  status: TaskStatus
  createdAt: string
  claimedAt?: string
  completedAt?: string
}

export interface Webhook {
  id: string
  url: string
  /** Empty means every event. */
  events: string[]
  createdAt: string
}

export interface InstanceDetail extends InstanceSummary {
  /** The last error the instance had. The engine keeps it after the instance has moved on. */
  errorInfo?: { code?: string; message?: string; elementId?: string; tokenId?: string }
}

export interface InstanceToken {
  id: string
  elementId: string
  elementType: string
  status: string
  /** What a waiting token is waiting for. */
  waitingFor?: { type: string }
}

/** The ways a person can push a stuck step along. */
export type ForcedAction = 'completeServiceTask' | 'failServiceTask' | 'fireTimer' | 'completeUserTask'

/** Set on a step that a person pushed along by hand. */
export interface ForcedStep {
  action: ForcedAction
  by: string
  reason: string
  /** For a task: the person it was assigned to. */
  onBehalfOf?: string
}

/** One finished step of an instance: when it arrived at an element, when it left, and how it went. */
export interface HistoryEntry {
  id: string
  elementId: string
  elementType: string
  /** `cancelled` covers steps that were interrupted (an instance cancelled, a boundary event fired). */
  status: 'completed' | 'cancelled' | 'error'
  startedAt: string
  completedAt: string
  /** The variables as they stood when the step finished; left out for very large ones. */
  variablesSnapshot?: Record<string, { type: string; value: unknown }>
  forced?: ForcedStep
}

/** One entry of an instance's audit trail, as the engine logged it. */
export interface InstanceEvent {
  id: string
  type: string
  occurredAt: string
  data: Record<string, unknown>
}

export interface InstanceView {
  instance: InstanceDetail
  /** The elements the instance is at right now. */
  tokens: InstanceToken[]
  variables: Record<string, unknown>
}

export type AuditActorKind = 'user' | 'adminKey' | 'apiKey' | 'anonymous'

/** One entry of the audit log: who did what, to which tenants, with a few facts. */
export interface AuditEntry {
  id: string
  at: string
  actor: { kind: AuditActorKind; id: string | null; label: string | null }
  /** Dotted code such as `tenant.suspend` or `login.failure`. */
  action: string
  tenantIds: string[]
  target: string | null
  details: Record<string, unknown>
}

export interface AuditQuery {
  tenant?: string
  actor?: string
  /** An exact action, or a family such as `key`. */
  action?: string
  /** ISO dates. */
  from?: string
  to?: string
  page: number
  pageSize: number
}

export interface AuditPage {
  entries: AuditEntry[]
  total: number
  page: number
  pageSize: number
}

/** A named, revocable credential for a program that administers the platform. The secret is not here. */
export interface OperatorKey {
  id: string
  name: string
  /** The person who created it, if any. */
  createdBy: string | null
  createdAt: string
  lastUsedAt: string | null
  /** After this moment the key is refused. Null: it does not expire. */
  expiresAt: string | null
  revokedAt: string | null
}
