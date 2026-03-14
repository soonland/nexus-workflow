import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockDbFindMany, mockDbCreate } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDbFindMany: vi.fn(),
  mockDbCreate: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/db/client', () => ({
  db: {
    organization: {
      findMany: mockDbFindMany,
      create: mockDbCreate,
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
import { GET, POST } from './route'

describe('GET /api/organizations', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('should return 401 when no session', async () => {
    mockAuth.mockResolvedValue(null)

    const res = await GET()

    expect(res._status).toBe(401)
    expect(res._data).toEqual({ error: 'Unauthorized' })
  })

  it('should return 200 with organizations list', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee' } })
    const orgs = [
      { id: 'org-1', name: 'Acme', owner: { id: 'emp-1', fullName: 'Alice' } },
    ]
    mockDbFindMany.mockResolvedValue(orgs)

    const res = await GET()

    expect(res._status).toBe(200)
    expect(res._data).toEqual(orgs)
    expect(mockDbFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { not: 'archived' } } }),
    )
  })
})

describe('POST /api/organizations', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('should return 403 when role is employee', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee' } })

    const req = new NextRequest('http://localhost/api/organizations', {
      body: JSON.stringify({ name: 'Acme' }),
    })
    const res = await POST(req)

    expect(res._status).toBe(403)
    expect(res._data).toEqual({ error: 'Forbidden' })
  })

  it('should return 201 on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'manager' } })
    const created = { id: 'org-1', name: 'Acme', owner: null }
    mockDbCreate.mockResolvedValue(created)

    const req = new NextRequest('http://localhost/api/organizations', {
      body: JSON.stringify({ name: 'Acme' }),
    })
    const res = await POST(req)

    expect(res._status).toBe(201)
    expect(res._data).toEqual(created)
    expect(mockDbCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Acme' }) }),
    )
  })
})
