import type { ApiKey, CreatedKey, Tenant } from './types'

/** An error response from the workflow API (status 0 means it could not be reached). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface AdminApi {
  listTenants(): Promise<Tenant[]>
  createTenant(id: string, name: string): Promise<Tenant>
  updateTenant(id: string, changes: { name?: string; status?: 'active' | 'suspended' }): Promise<Tenant>
  deleteTenant(id: string): Promise<void>
  listKeys(tenantId: string): Promise<ApiKey[]>
  createKey(tenantId: string, name: string): Promise<CreatedKey>
  revokeKey(tenantId: string, keyId: string): Promise<void>
}

/**
 * Client for the operator endpoints of nexus-workflow-app (`/tenants`). Requests use relative
 * URLs: in production the console is served by the API itself, in development Vite proxies them.
 * `getKey` is read on every call so signing in or out takes effect immediately.
 */
export function createAdminApi(getKey: () => string | null, fetchImpl: typeof fetch = fetch): AdminApi {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {}
    const key = getKey()
    if (key) headers['Authorization'] = `Bearer ${key}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    let response: Response
    try {
      response = await fetchImpl(path, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch {
      throw new ApiError(0, 'Could not reach the workflow API. Is nexus-workflow-app running?')
    }

    if (!response.ok) throw await toApiError(response)
    return (await response.json()) as T
  }

  const tenantPath = (id: string) => `/tenants/${encodeURIComponent(id)}`

  return {
    async listTenants() {
      return (await request<{ tenants: Tenant[] }>('GET', '/tenants')).tenants
    },
    async createTenant(id, name) {
      return (await request<{ tenant: Tenant }>('POST', '/tenants', { id, name })).tenant
    },
    async updateTenant(id, changes) {
      return (await request<{ tenant: Tenant }>('PATCH', tenantPath(id), changes)).tenant
    },
    async deleteTenant(id) {
      await request('DELETE', tenantPath(id))
    },
    async listKeys(tenantId) {
      return (await request<{ keys: ApiKey[] }>('GET', `${tenantPath(tenantId)}/keys`)).keys
    },
    createKey(tenantId, name) {
      return request<CreatedKey>('POST', `${tenantPath(tenantId)}/keys`, { name })
    },
    async revokeKey(tenantId, keyId) {
      await request('DELETE', `${tenantPath(tenantId)}/keys/${encodeURIComponent(keyId)}`)
    },
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  if (response.status === 403) {
    return new ApiError(403, 'The admin key was rejected. Check that it matches ADMIN_API_KEY on the server.', 'FORBIDDEN')
  }
  try {
    const body = (await response.json()) as { error?: string; message?: string }
    return new ApiError(response.status, body.message ?? `Request failed (${response.status})`, body.error)
  } catch {
    return new ApiError(response.status, `Request failed (${response.status})`)
  }
}
