import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockDbFindUnique, mockDbUpdate } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDbFindUnique: vi.fn(),
  mockDbUpdate: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
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
import { POST } from './route'

const params = Promise.resolve({ id: 'org-1' })

describe('POST /api/organizations/[id]/deactivate', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('should return 403 when role is employee', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee' } })

    const req = new NextRequest('http://localhost/api/organizations/org-1/deactivate')
    const res = await POST(req, { params })

    expect(res._status).toBe(403)
    expect(res._data).toEqual({ error: 'Forbidden' })
  })

  it('should return 404 when organization not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'manager' } })
    mockDbFindUnique.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/organizations/org-1/deactivate')
    const res = await POST(req, { params })

    expect(res._status).toBe(404)
    expect(res._data).toEqual({ error: 'Not found' })
  })

  it('should return 200 and set status to inactive', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'manager' } })
    mockDbFindUnique.mockResolvedValue({ id: 'org-1' })
    const updated = { id: 'org-1', status: 'inactive', owner: null }
    mockDbUpdate.mockResolvedValue(updated)

    const req = new NextRequest('http://localhost/api/organizations/org-1/deactivate')
    const res = await POST(req, { params })

    expect(res._status).toBe(200)
    expect(res._data).toEqual(updated)
    expect(mockDbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'inactive' }) }),
    )
  })
})
