import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError, createAdminApi, createTenantApi } from './client'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('createAdminApi', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  const api = () => createAdminApi(() => 'admin-secret', fetchMock as unknown as typeof fetch)

  beforeEach(() => {
    fetchMock = vi.fn()
  })

  const lastCall = () => {
    const [url, init] = fetchMock.mock.calls.at(-1)!
    return { url: url as string, init: init as RequestInit, headers: init.headers as Record<string, string> }
  }

  it('sends the admin key as a Bearer token on every request', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ tenants: [] }))
    await api().listTenants()
    expect(lastCall().headers['Authorization']).toBe('Bearer admin-secret')
  })

  it('listTenants unwraps the tenants array', async () => {
    const tenants = [{ id: 'a', name: 'A', status: 'active', createdAt: 'x', activeKeyCount: 1 }]
    fetchMock.mockResolvedValue(jsonResponse({ tenants }))
    expect(await api().listTenants()).toEqual(tenants)
    expect(lastCall().url).toBe('/tenants')
  })

  it('createTenant POSTs id and name', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ tenant: { id: 'acme' } }, 201))
    await api().createTenant('acme', 'Acme')
    expect(lastCall().url).toBe('/tenants')
    expect(lastCall().init.method).toBe('POST')
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ id: 'acme', name: 'Acme' })
    expect(lastCall().headers['Content-Type']).toBe('application/json')
  })

  it('updateTenant PATCHes the given changes and returns the tenant', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ tenant: { id: 'acme', status: 'suspended' } }))
    const tenant = await api().updateTenant('acme', { status: 'suspended' })
    expect(lastCall().url).toBe('/tenants/acme')
    expect(lastCall().init.method).toBe('PATCH')
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ status: 'suspended' })
    expect(tenant.status).toBe('suspended')
  })

  it('deleteTenant sends DELETE', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true }))
    await api().deleteTenant('acme')
    expect(lastCall().url).toBe('/tenants/acme')
    expect(lastCall().init.method).toBe('DELETE')
  })

  it('URL-encodes ids', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ keys: [] }))
    await api().listKeys('a/b c')
    expect(lastCall().url).toBe('/tenants/a%2Fb%20c/keys')
  })

  it('createKey returns the key and its one-time plaintext', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ key: { id: 'k1' }, plaintext: 'abc123' }, 201))
    const created = await api().createKey('acme', 'ci')
    expect(lastCall().url).toBe('/tenants/acme/keys')
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ name: 'ci' })
    expect(created.plaintext).toBe('abc123')
  })

  it('listKeys unwraps the keys array; revokeKey sends DELETE', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ keys: [{ id: 'k1' }] }))
    expect(await api().listKeys('acme')).toEqual([{ id: 'k1' }])
    expect(lastCall().url).toBe('/tenants/acme/keys')

    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }))
    await api().revokeKey('acme', 'k1')
    expect(lastCall().url).toBe('/tenants/acme/keys/k1')
    expect(lastCall().init.method).toBe('DELETE')
  })

  it('throws an ApiError carrying the status, code and message from the API', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'CONFLICT', message: "Tenant 'acme' already exists" }, 409))
    const error = await api().createTenant('acme', 'Acme').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, code: 'CONFLICT', message: "Tenant 'acme' already exists" })
  })

  it('passes on the server\'s own message for a 403', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'FORBIDDEN', message: 'Operator access required' }, 403))
    await expect(api().listTenants()).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', message: 'Operator access required' })
  })

  it('sends the CSRF header on every request, so session calls are accepted by the server', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ tenants: [] }))
    await api().listTenants()
    expect(lastCall().headers['X-Nexus-Console']).toBe('1')
  })

  it('sends no Authorization header when it holds no admin key (the session cookie does the work)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ users: [] }))
    await createAdminApi(() => null, fetchMock as unknown as typeof fetch).listUsers()
    expect(lastCall().headers['Authorization']).toBeUndefined()
    expect(lastCall().url).toBe('/users')
  })

  it('still throws a useful ApiError when the body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('Bad gateway', { status: 502 }))
    await expect(api().listTenants()).rejects.toMatchObject({ status: 502, message: expect.stringContaining('502') })
  })

  it('wraps network failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(api().listTenants()).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/reach/i) })
  })

  it('uses the key returned by the getter at call time', async () => {
    let key = 'first'
    fetchMock.mockImplementation(async () => jsonResponse({ tenants: [] }))
    const a = createAdminApi(() => key, fetchMock as unknown as typeof fetch)
    await a.listTenants()
    key = 'second'
    await a.listTenants()
    expect((fetchMock.mock.calls[1]![1].headers as Record<string, string>)['Authorization']).toBe('Bearer second')
  })
  describe('onUnauthorized', () => {
    const withCallback = () => {
      const onUnauthorized = vi.fn()
      const a = createAdminApi(() => 'stale', fetchMock as unknown as typeof fetch, { onUnauthorized })
      return { a, onUnauthorized }
    }

    it('is called when the API answers 401, and the error is still thrown', async () => {
      fetchMock.mockImplementation(async () => jsonResponse({ error: 'X', message: 'nope' }, 401))
      const { a, onUnauthorized } = withCallback()

      await expect(a.listTenants()).rejects.toMatchObject({ status: 401 })

      expect(onUnauthorized).toHaveBeenCalledOnce()
    })

    it.each([403, 404, 409, 500])('is not called for a %i', async (status) => {
      fetchMock.mockImplementation(async () => jsonResponse({ error: 'X', message: 'nope' }, status))
      const { a, onUnauthorized } = withCallback()

      await expect(a.listTenants()).rejects.toBeInstanceOf(ApiError)

      expect(onUnauthorized).not.toHaveBeenCalled()
    })

    it('is not called when the API cannot be reached', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
      const { a, onUnauthorized } = withCallback()

      await expect(a.listTenants()).rejects.toMatchObject({ status: 0 })

      expect(onUnauthorized).not.toHaveBeenCalled()
    })
  })

  describe('people and sessions', () => {
    const body = () => JSON.parse(lastCall().init.body as string)

    it('createUser POSTs the person and returns the user with the invitation', async () => {
      const reply = { user: { id: 'u1' }, invite: { token: 't', path: '/console/invite/t', expiresAt: 'x' } }
      fetchMock.mockResolvedValue(jsonResponse(reply, 201))
      const result = await api().createUser({ email: 'a@b.c', name: 'A', memberships: [{ role: 'tenant_manager', tenantId: 'acme' }] })
      expect(lastCall().url).toBe('/users')
      expect(body()).toEqual({ email: 'a@b.c', name: 'A', memberships: [{ role: 'tenant_manager', tenantId: 'acme' }] })
      expect(result.invite.path).toBe('/console/invite/t')
    })

    it('setUserStatus, addMembership, removeMembership and reinviteUser hit the right routes', async () => {
      fetchMock.mockImplementation(async () => jsonResponse({ success: true, invite: { token: 't' } }))
      await api().setUserStatus('u 1', 'disabled')
      expect([lastCall().url, lastCall().init.method, body()]).toEqual(['/users/u%201', 'PATCH', { status: 'disabled' }])
      await api().addMembership('u1', { role: 'operator' })
      expect([lastCall().url, lastCall().init.method, body()]).toEqual(['/users/u1/memberships', 'POST', { role: 'operator' }])
      await api().removeMembership('u1', 'm1')
      expect([lastCall().url, lastCall().init.method]).toEqual(['/users/u1/memberships/m1', 'DELETE'])
      expect((await api().reinviteUser('u1')).token).toBe('t')
      expect([lastCall().url, lastCall().init.method]).toEqual(['/users/u1/invite', 'POST'])
    })

    it('login POSTs the credentials, and a wrong password does not count as a session ending', async () => {
      const onUnauthorized = vi.fn()
      const a = createAdminApi(() => null, fetchMock as unknown as typeof fetch, { onUnauthorized })
      fetchMock.mockResolvedValue(jsonResponse({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' }, 401))

      await expect(a.login('a@b.c', 'wrong')).rejects.toMatchObject({ status: 401, message: 'Invalid email or password' })

      expect([lastCall().url, body()]).toEqual(['/auth/login', { email: 'a@b.c', password: 'wrong' }])
      expect(onUnauthorized).not.toHaveBeenCalled()
    })

    it('me() answers null when there is no session, and the error for anything else', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'UNAUTHENTICATED', message: 'Not signed in' }, 401))
      expect(await api().me()).toBeNull()
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'X', message: 'boom' }, 500))
      await expect(api().me()).rejects.toMatchObject({ status: 500 })
    })

    it('inviteInfo and acceptInvite POST the token in the body, never in the URL', async () => {
      fetchMock.mockImplementation(async () => jsonResponse({ email: 'a@b.c', name: 'A', expiresAt: 'x' }))
      await api().inviteInfo('secret-token')
      expect([lastCall().url, body()]).toEqual(['/auth/invite-info', { token: 'secret-token' }])
      await api().acceptInvite('secret-token', 'pw')
      expect([lastCall().url, body()]).toEqual(['/auth/accept-invite', { token: 'secret-token', password: 'pw' }])
    })

    it('logout POSTs to /auth/logout', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ success: true }))
      await api().logout()
      expect([lastCall().url, lastCall().init.method]).toEqual(['/auth/logout', 'POST'])
    })
  })

  describe('tenant calls', () => {
    it('name the tenant in X-Tenant, along with the CSRF header', async () => {
      fetchMock.mockImplementation(async () => jsonResponse([{ id: 'd1' }]))
      const tenant = createTenantApi('acme', () => null, fetchMock as unknown as typeof fetch)

      expect(await tenant.listDefinitions()).toEqual([{ id: 'd1' }])

      expect(lastCall().url).toBe('/definitions')
      expect(lastCall().headers['X-Tenant']).toBe('acme')
      expect(lastCall().headers['X-Nexus-Console']).toBe('1')
    })

    it('sign the user out on a 401 but not on a 403', async () => {
      const onUnauthorized = vi.fn()
      const tenant = createTenantApi('acme', () => null, fetchMock as unknown as typeof fetch, { onUnauthorized })
      fetchMock.mockImplementationOnce(async () => jsonResponse({ error: 'FORBIDDEN', message: 'no' }, 403))
      await expect(tenant.listDefinitions()).rejects.toMatchObject({ status: 403 })
      expect(onUnauthorized).not.toHaveBeenCalled()

      fetchMock.mockImplementationOnce(async () => jsonResponse({ error: 'UNAUTHENTICATED' }, 401))
      await expect(tenant.listDefinitions()).rejects.toMatchObject({ status: 401 })
      expect(onUnauthorized).toHaveBeenCalledOnce()
    })

    it('never send X-Tenant on operator calls', async () => {
      fetchMock.mockImplementation(async () => jsonResponse({ tenants: [] }))
      await api().listTenants()
      expect(lastCall().headers['X-Tenant']).toBeUndefined()
    })
  })
})
