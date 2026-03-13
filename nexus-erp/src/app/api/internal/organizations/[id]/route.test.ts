import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDbOrgFindUnique } = vi.hoisted(() => {
  process.env.INTERNAL_API_KEY = 'secret-key'
  return { mockDbOrgFindUnique: vi.fn() }
})

vi.mock('@/db/client', () => ({
  db: { organization: { findUnique: mockDbOrgFindUnique } },
}))

vi.mock('next/server', () => {
  class MockNextRequest {
    private _headers: Map<string, string>
    constructor(_url: string, init?: { headers?: Record<string, string> }) {
      this._headers = new Map(Object.entries(init?.headers ?? {}))
    }
    get headers() {
      return { get: (k: string) => this._headers.get(k) ?? null }
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
import { GET } from './route'

const PARAMS = { params: Promise.resolve({ id: 'org-1' }) }

function makeRequest(token?: string) {
  return new NextRequest('http://localhost/api/internal/organizations/org-1', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

const ORG = { id: 'org-1', name: 'Acme', owner: { id: 'emp-1', userId: 'user-1', fullName: 'Alice' } }

describe('GET /api/internal/organizations/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbOrgFindUnique.mockResolvedValue(ORG)
  })

  it('should return 401 when no authorization header', async () => {
    const res = await GET(makeRequest(), PARAMS)
    expect(res._status).toBe(401)
  })

  it('should return 401 when token is wrong', async () => {
    const res = await GET(makeRequest('bad'), PARAMS)
    expect(res._status).toBe(401)
  })

  it('should return 404 when organization not found', async () => {
    mockDbOrgFindUnique.mockResolvedValue(null)
    const res = await GET(makeRequest('secret-key'), PARAMS)
    expect(res._status).toBe(404)
    expect((res._data as any).error).toBe('Not found')
  })

  it('should return organization with correct token', async () => {
    const res = await GET(makeRequest('secret-key'), PARAMS)
    expect(res._status).toBe(200)
    expect((res._data as any).id).toBe('org-1')
  })
})
