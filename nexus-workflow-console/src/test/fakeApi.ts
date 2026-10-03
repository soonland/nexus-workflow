import { vi } from 'vitest'
import type { AdminApi, TenantApi } from '../api/client'
import type { ApiKey, DefinitionSummary, InstanceSummary, Membership, UserTask, Webhook, SessionInfo, Tenant, User, UserWithMemberships } from '../api/types'

export function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: 'acme',
    name: 'Acme Corp',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    activeKeyCount: 1,
    ...overrides,
  }
}

export function makeKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'key-1',
    tenantId: 'acme',
    name: 'ci',
    createdAt: '2026-01-02T00:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  }
}

export function makeUser(overrides: Partial<UserWithMemberships> = {}): UserWithMemberships {
  return {
    id: 'u1',
    email: 'ada@example.com',
    name: 'Ada',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLoginAt: null,
    hasPassword: true,
    memberships: [],
    ...overrides,
  }
}

export function makeMembership(overrides: Partial<Membership> = {}): Membership {
  return { id: 'm1', userId: 'u1', role: 'operator', tenantId: null, createdAt: '2026-01-01T00:00:00.000Z', ...overrides }
}

export const operatorSession = (): SessionInfo => ({
  user: makeUser({ id: 'op', email: 'op@example.com', name: 'Olive Operator' }) as User,
  memberships: [makeMembership({ id: 'mo', userId: 'op', role: 'operator' })],
})

export const managerSession = (...tenantIds: string[]): SessionInfo => ({
  user: makeUser({ id: 'mgr', email: 'mgr@example.com', name: 'Max Manager' }) as User,
  memberships: tenantIds.map((tenantId) => makeMembership({ id: `mm-${tenantId}`, userId: 'mgr', role: 'tenant_manager', tenantId })),
})

/** An AdminApi whose every method is a vi.fn() with a sensible default result. */
export function makeFakeApi(overrides: Partial<AdminApi> = {}): { [K in keyof AdminApi]: ReturnType<typeof vi.fn> } & AdminApi {
  return {
    listTenants: vi.fn().mockResolvedValue([]),
    createTenant: vi.fn().mockResolvedValue(makeTenant()),
    updateTenant: vi.fn().mockResolvedValue(makeTenant()),
    deleteTenant: vi.fn().mockResolvedValue(undefined),
    listKeys: vi.fn().mockResolvedValue([]),
    createKey: vi.fn().mockResolvedValue({ key: makeKey(), plaintext: 'plain-secret-key' }),
    revokeKey: vi.fn().mockResolvedValue(undefined),
    listUsers: vi.fn().mockResolvedValue([]),
    createUser: vi.fn().mockResolvedValue({ user: makeUser(), invite: { token: 't', path: '/console/invite/t', expiresAt: '2026-02-01T00:00:00.000Z' } }),
    setUserStatus: vi.fn().mockResolvedValue(undefined),
    addMembership: vi.fn().mockResolvedValue(undefined),
    removeMembership: vi.fn().mockResolvedValue(undefined),
    reinviteUser: vi.fn().mockResolvedValue({ token: 't2', path: '/console/invite/t2', expiresAt: '2026-02-01T00:00:00.000Z' }),
    me: vi.fn().mockResolvedValue(null),
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    inviteInfo: vi.fn(),
    acceptInvite: vi.fn(),
    ...overrides,
  } as never
}

export function makeDefinition(overrides: Partial<DefinitionSummary> = {}): DefinitionSummary {
  return { id: 'approval', version: 1, name: 'Approval', deployedAt: '2026-01-03T00:00:00.000Z', isDeployable: true, ...overrides }
}

export function makeInstance(overrides: Partial<InstanceSummary> = {}): InstanceSummary {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    definitionId: 'approval',
    definitionVersion: 1,
    status: 'active',
    startedAt: '2026-01-04T00:00:00.000Z',
    ...overrides,
  }
}

/** A TenantApi whose every method is a vi.fn() with a sensible default result. */
export function makeFakeTenantApi(): { [K in keyof TenantApi]: ReturnType<typeof vi.fn> } & TenantApi {
  return {
    listDefinitions: vi.fn().mockResolvedValue([]),
    deleteDefinition: vi.fn().mockResolvedValue(undefined),
    listInstances: vi.fn().mockResolvedValue({ items: [], total: 0, page: 0, pageSize: 20 }),
    suspendInstance: vi.fn().mockResolvedValue(undefined),
    resumeInstance: vi.fn().mockResolvedValue(undefined),
    cancelInstance: vi.fn().mockResolvedValue(undefined),
    restartInstance: vi.fn().mockResolvedValue('new-instance'),
    listTasks: vi.fn().mockResolvedValue({ items: [], total: 0, page: 0, pageSize: 20 }),
    claimTask: vi.fn().mockResolvedValue(undefined),
    releaseTask: vi.fn().mockResolvedValue(undefined),
    completeTask: vi.fn().mockResolvedValue(undefined),
    listWebhooks: vi.fn().mockResolvedValue([]),
    createWebhook: vi.fn().mockResolvedValue(undefined),
    deleteWebhook: vi.fn().mockResolvedValue(undefined),
  } as never
}

export function makeTask(overrides: Partial<UserTask> = {}): UserTask {
  return {
    id: 'task-1',
    instanceId: 'aaaaaaaa-1111-2222-3333-444444444444',
    name: 'Review timesheet',
    priority: 50,
    status: 'open',
    createdAt: '2026-01-05T00:00:00.000Z',
    ...overrides,
  }
}

export function makeWebhook(overrides: Partial<Webhook> = {}): Webhook {
  return { id: 'hook-1', url: 'https://example.com/hook', events: [], createdAt: '2026-01-06T00:00:00.000Z', ...overrides }
}
