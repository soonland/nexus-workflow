import { vi } from 'vitest'
import type { AdminApi } from '../api/client'
import type { ApiKey, Tenant } from '../api/types'

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
    ...overrides,
  } as never
}
