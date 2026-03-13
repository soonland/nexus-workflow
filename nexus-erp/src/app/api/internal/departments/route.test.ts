import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDbDepartmentFindMany } = vi.hoisted(() => {
  process.env.INTERNAL_API_KEY = 'secret-key'
  return { mockDbDepartmentFindMany: vi.fn() }
})

vi.mock('@/db/client', () => ({
  db: { department: { findMany: mockDbDepartmentFindMany } },
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

function makeRequest(token?: string) {
  return new NextRequest('http://localhost/api/internal/departments', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

describe('GET /api/internal/departments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbDepartmentFindMany.mockResolvedValue([{ id: 'dept-1', name: 'Engineering' }])
  })

  it('should return 401 when no authorization header', async () => {
    const res = await GET(makeRequest())
    expect(res._status).toBe(401)
    expect((res._data as any).error).toBe('Unauthorized')
  })

  it('should return 401 when token is wrong', async () => {
    const res = await GET(makeRequest('wrong-token'))
    expect(res._status).toBe(401)
  })

  it('should return departments with correct token', async () => {
    const res = await GET(makeRequest('secret-key'))
    expect(res._status).toBe(200)
    expect(res._data).toHaveLength(1)
    expect((res._data as any)[0].name).toBe('Engineering')
  })
})
