import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockCanAccess, mockDbFindUnique, mockDbUpdate } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCanAccess: vi.fn(),
  mockDbFindUnique: vi.fn(),
  mockDbUpdate: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/access', () => ({ canAccess: mockCanAccess }))
vi.mock('@/db/client', () => ({
  db: {
    organization: {
      findUnique: mockDbFindUnique,
      update: mockDbUpdate,
    },
  },
}))
vi.mock('next/server', () => {
  class MockNextRequest {
    private _body: unknown
    url: string
    nextUrl: URL
    constructor(url: string, init?: { body?: string }) {
      this._body = init?.body ? JSON.parse(init.body) : {}
      this.url = url
      this.nextUrl = new URL(url)
    }
    async json() {
      return this._body
    }
  }
  class MockNextResponse {
    _data: unknown
    _status: number
    constructor(data: unknown, init?: { status?: number }) {
      this._data = data
      this._status = init?.status ?? 200
    }
    static json(data: unknown, init?: { status?: number }) {
      return new MockNextResponse(data, init)
    }
  }
  return { NextRequest: MockNextRequest, NextResponse: MockNextResponse }
})

import { NextRequest } from 'next/server'
import { GET, PATCH, DELETE } from './route'

const params = Promise.resolve({ id: 'org-1' })

describe('GET /api/organizations/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('should return 401 when no session', async () => {
    mockAuth.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/organizations/org-1')
    const res = await GET(req, { params })

    expect(res._status).toBe(401)
    expect(res._data).toEqual({ error: 'Unauthorized' })
  })

  it('should return 404 when organization not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee' } })
    mockDbFindUnique.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/organizations/org-1')
    const res = await GET(req, { params })

    expect(res._status).toBe(404)
    expect(res._data).toEqual({ error: 'Not found' })
  })

  it('should return 200 with organization', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee' } })
    const org = { id: 'org-1', name: 'Acme', owner: { id: 'emp-1', fullName: 'Alice' } }
    mockDbFindUnique.mockResolvedValue(org)

    const req = new NextRequest('http://localhost/api/organizations/org-1')
    const res = await GET(req, { params })

    expect(res._status).toBe(200)
    expect(res._data).toEqual(org)
  })
})

describe('PATCH /api/organizations/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('should return 403 when canAccess returns false', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee' } })
    mockDbFindUnique.mockResolvedValue({ id: 'org-1', owner: { userId: 'user-2' } })
    mockCanAccess.mockResolvedValue(false)

    const req = new NextRequest('http://localhost/api/organizations/org-1', {
      body: JSON.stringify({ name: 'Updated' }),
    })
    const res = await PATCH(req, { params })

    expect(res._status).toBe(403)
    expect(res._data).toEqual({ error: 'Forbidden' })
  })

  it('should return 200 on success', async () => {
    const session = { user: { id: 'user-1', role: 'manager' } }
    mockAuth.mockResolvedValue(session)
    mockDbFindUnique.mockResolvedValue({ id: 'org-1', owner: { userId: 'user-1' } })
    mockCanAccess.mockResolvedValue(true)
    const updated = { id: 'org-1', name: 'Updated', owner: null }
    mockDbUpdate.mockResolvedValue(updated)

    const req = new NextRequest('http://localhost/api/organizations/org-1', {
      body: JSON.stringify({ name: 'Updated' }),
    })
    const res = await PATCH(req, { params })

    expect(res._status).toBe(200)
    expect(res._data).toEqual(updated)
  })
})

describe('DELETE /api/organizations/[id]', () => {
  it('should return 405', async () => {
    const res = await DELETE()

    expect(res._status).toBe(405)
  })
})
