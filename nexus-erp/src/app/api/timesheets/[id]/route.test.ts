import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockDbFindUnique } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDbFindUnique: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/db/client', () => ({
  db: {
    timesheet: { findUnique: mockDbFindUnique },
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
    async json() { return this._body }
  }
  class MockNextResponse {
    _data: unknown; _status: number
    constructor(data: unknown, init?: { status?: number }) { this._data = data; this._status = init?.status ?? 200 }
    static json(data: unknown, init?: { status?: number }) { return new MockNextResponse(data, init) }
  }
  return { NextRequest: MockNextRequest, NextResponse: MockNextResponse }
})

import { NextRequest } from 'next/server'
import { GET } from './route'

const PARAMS = { params: Promise.resolve({ id: 'ts-1' }) }

function makeRequest() {
  return new NextRequest('http://localhost/api/timesheets/ts-1')
}

const BASE_TIMESHEET = { id: 'ts-1', employeeId: 'emp-1', status: 'draft', entries: [] }

describe('GET /api/timesheets/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 when no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest(), PARAMS)
    expect(res._status).toBe(401)
    expect((res._data as any).error).toBe('Unauthorized')
  })

  it('should return 404 when timesheet not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: 'emp-1' } })
    mockDbFindUnique.mockResolvedValue(null)
    const res = await GET(makeRequest(), PARAMS)
    expect(res._status).toBe(404)
  })

  it('should return 403 when employee tries to view another employee timesheet', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2', role: 'employee', employeeId: 'emp-other' } })
    mockDbFindUnique.mockResolvedValue(BASE_TIMESHEET)
    const res = await GET(makeRequest(), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 200 when owner views their own timesheet', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: 'emp-1' } })
    mockDbFindUnique.mockResolvedValue(BASE_TIMESHEET)
    const res = await GET(makeRequest(), PARAMS)
    expect(res._status).toBe(200)
    expect(res._data).toEqual(BASE_TIMESHEET)
  })
})
