import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockDbUserUpdate } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDbUserUpdate: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/db/client', () => ({ db: { user: { update: mockDbUserUpdate } } }))

vi.mock('next/server', () => {
  class MockNextRequest {
    private _body: unknown
    constructor(_url: string, init?: { method?: string; body?: string }) {
      this._body = init?.body ? JSON.parse(init.body) : {}
    }
    async json() { return this._body }
  }
  const NextResponse = {
    json: (data: unknown, init?: { status?: number }) => ({
      _data: data,
      _status: init?.status ?? 200,
    }),
  }
  return { NextRequest: MockNextRequest, NextResponse }
})

import { NextRequest } from 'next/server'
import { PATCH } from './route'

function makeRequest(body: unknown, userId = 'user-1') {
  return new NextRequest(`http://localhost/api/users/${userId}/preferences`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('PATCH /api/users/[id]/preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbUserUpdate.mockResolvedValue({ id: 'user-1', theme: 'dark' })
  })

  it('should return 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makeRequest({ theme: 'dark' }), makeParams('user-1'))
    expect(res._status).toBe(401)
    expect((res._data as any).error).toBe('Unauthorized')
  })

  it('should return 403 when the session user is not the target user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2' } })
    const res = await PATCH(makeRequest({ theme: 'dark' }), makeParams('user-1'))
    expect(res._status).toBe(403)
    expect((res._data as any).error).toBe('Forbidden')
  })

  it('should allow a user to update their own preferences', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const res = await PATCH(makeRequest({ theme: 'dark' }), makeParams('user-1'))
    expect(res._status).toBe(200)
  })

  it('should return 400 for an unknown theme value', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const res = await PATCH(makeRequest({ theme: 'hacker-theme' }), makeParams('user-1'))
    expect(res._status).toBe(400)
  })

  it('should return 400 when the theme field is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const res = await PATCH(makeRequest({}), makeParams('user-1'))
    expect(res._status).toBe(400)
  })

  it('should return 400 when the body is not an object', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    const res = await PATCH(makeRequest('not-an-object'), makeParams('user-1'))
    expect(res._status).toBe(400)
  })

  it.each([
    ['light'],
    ['dark'],
    ['system'],
    ['nexus-light-pro'],
    ['nexus-dark-pro'],
  ] as const)('should accept theme value "%s"', async (themeId) => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockDbUserUpdate.mockResolvedValue({ id: 'user-1', theme: themeId })
    const res = await PATCH(makeRequest({ theme: themeId }), makeParams('user-1'))
    expect(res._status).toBe(200)
    expect((res._data as any).theme).toBe(themeId)
  })

  it('should call db.user.update with the correct id and theme', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    await PATCH(makeRequest({ theme: 'nexus-dark-pro' }), makeParams('user-1'))
    expect(mockDbUserUpdate).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'user-1' },
      data: { theme: 'nexus-dark-pro' },
      select: { theme: true, locale: true },
    })
  })

  it('should return the saved theme in the response body', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } })
    mockDbUserUpdate.mockResolvedValue({ theme: 'nexus-light-pro', locale: null })
    const res = await PATCH(makeRequest({ theme: 'nexus-light-pro' }), makeParams('user-1'))
    expect((res._data as any).theme).toBe('nexus-light-pro')
  })

  // TODO: test — DB error propagation (requires integration test or error mock)
  // TODO: test — concurrent PATCH requests from the same user (integration)
})
