import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError, createAdminApi } from './client'

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

  it('explains a 403 as an invalid admin key', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'FORBIDDEN', message: 'Admin API key required' }, 403))
    await expect(api().listTenants()).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/admin key/i) })
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

    it.each([401, 403])('is called when the API answers %i, and the error is still thrown', async (status) => {
      fetchMock.mockImplementation(async () => jsonResponse({ error: 'X', message: 'nope' }, status))
      const { a, onUnauthorized } = withCallback()

      await expect(a.listTenants()).rejects.toMatchObject({ status })

      expect(onUnauthorized).toHaveBeenCalledOnce()
    })

    it.each([404, 409, 500])('is not called for a %i', async (status) => {
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
})
