import type {
  ApiKey,
  CreatedKey,
  Invite,
  InviteInfo,
  MembershipRequest,
  SessionInfo,
  Tenant,
  User,
  UserWithMemberships,
} from './types'

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

  // people (needs a session or the admin key)
  listUsers(): Promise<UserWithMemberships[]>
  createUser(input: { email: string; name: string; memberships?: MembershipRequest[] }): Promise<{ user: User; invite: Invite }>
  setUserStatus(userId: string, status: 'active' | 'disabled'): Promise<void>
  addMembership(userId: string, membership: MembershipRequest): Promise<void>
  removeMembership(userId: string, membershipId: string): Promise<void>
  reinviteUser(userId: string): Promise<Invite>

  // sessions
  /** The signed-in user, or null when there is no (valid) session. */
  me(): Promise<SessionInfo | null>
  login(email: string, password: string): Promise<SessionInfo>
  logout(): Promise<void>
  inviteInfo(token: string): Promise<InviteInfo>
  acceptInvite(token: string, password: string): Promise<SessionInfo>
}

export interface AdminApiOptions {
  /**
   * Called when the API answers 401 to an authenticated request, i.e. the credential the console
   * holds is not accepted (the session expired, or the admin key was revoked or rotated). The error
   * is still thrown. A 403 means "not allowed", not "signed out", so it never triggers this.
   */
  onUnauthorized?: () => void
}

/**
 * Client for the operator endpoints of nexus-workflow-app (`/tenants`). Requests use relative
 * URLs: in production the console is served by the API itself, in development Vite proxies them.
 * `getKey` is read on every call so signing in or out takes effect immediately.
 */
export function createAdminApi(
  getKey: () => string | null,
  fetchImpl: typeof fetch = fetch,
  options: AdminApiOptions = {},
): AdminApi {
  async function request<T>(method: string, path: string, body?: unknown, authenticated = true): Promise<T> {
    // The server refuses state-changing calls made with a session cookie unless they carry this
    // header (a page on another site cannot add it), so it goes on every call.
    const headers: Record<string, string> = { 'X-Nexus-Console': '1' }
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

    if (!response.ok) {
      if (response.status === 401 && authenticated) options.onUnauthorized?.()
      throw await toApiError(response)
    }
    return (await response.json()) as T
  }

  const tenantPath = (id: string) => `/tenants/${encodeURIComponent(id)}`
  const userPath = (id: string) => `/users/${encodeURIComponent(id)}`

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
    async listUsers() {
      return (await request<{ users: UserWithMemberships[] }>('GET', '/users')).users
    },
    createUser(input) {
      return request<{ user: User; invite: Invite }>('POST', '/users', input)
    },
    async setUserStatus(userId, status) {
      await request('PATCH', userPath(userId), { status })
    },
    async addMembership(userId, membership) {
      await request('POST', `${userPath(userId)}/memberships`, membership)
    },
    async removeMembership(userId, membershipId) {
      await request('DELETE', `${userPath(userId)}/memberships/${encodeURIComponent(membershipId)}`)
    },
    async reinviteUser(userId) {
      return (await request<{ invite: Invite }>('POST', `${userPath(userId)}/invite`)).invite
    },
    async me() {
      try {
        return await request<SessionInfo>('GET', '/auth/me', undefined, false)
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    login(email, password) {
      return request<SessionInfo>('POST', '/auth/login', { email, password }, false)
    },
    async logout() {
      await request('POST', '/auth/logout', undefined, false)
    },
    inviteInfo(token) {
      return request<InviteInfo>('POST', '/auth/invite-info', { token }, false)
    },
    acceptInvite(token, password) {
      return request<SessionInfo>('POST', '/auth/accept-invite', { token, password }, false)
    },
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { error?: string; message?: string }
    return new ApiError(response.status, body.message ?? `Request failed (${response.status})`, body.error)
  } catch {
    return new ApiError(response.status, `Request failed (${response.status})`)
  }
}
