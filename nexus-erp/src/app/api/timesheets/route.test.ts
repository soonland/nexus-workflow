import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockDbFindMany, mockDbCreate } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDbFindMany: vi.fn(),
  mockDbCreate: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/db/client', () => ({
  db: {
    timesheet: { findMany: mockDbFindMany, create: mockDbCreate },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
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
import { GET, POST } from './route'

function makeGetRequest(params?: Record<string, string>) {
  const url = new URL('http://localhost/api/timesheets')
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  }
  return new NextRequest(url.toString())
}

function makePostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/timesheets', {
    body: JSON.stringify(body),
  })
}

describe('GET /api/timesheets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 403 when session has no employeeId', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: null } })
    const res = await GET(makeGetRequest())
    expect(res._status).toBe(403)
  })

  it('should return 200 with mapped timesheets including totalHours', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: 'emp-1' } })
    mockDbFindMany.mockResolvedValue([
      {
        id: 'ts-1',
        employeeId: 'emp-1',
        weekStart: new Date('2025-01-06'),
        status: 'draft',
        entries: [
          { date: new Date('2025-01-06'), hours: 8, projectCode: 'P1', description: null },
        ],
      },
    ])

    const res = await GET(makeGetRequest())
    expect(res._status).toBe(200)
    const data = res._data as any[]
    expect(data).toHaveLength(1)
    expect(data[0].totalHours).toBe(8)
    expect(data[0].entries[0].hours).toBe(8)
    expect(data[0].entries[0].date).toBe('2025-01-06')
  })
})

describe('POST /api/timesheets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 403 when session has no employeeId', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: null } })
    const res = await POST(makePostRequest({ weekStart: '2025-01-06' }))
    expect(res._status).toBe(403)
  })

  it('should return 409 when db.timesheet.create throws P2002', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: 'emp-1' } })
    mockDbCreate.mockRejectedValue({ code: 'P2002' })
    const res = await POST(makePostRequest({ weekStart: '2025-01-06' }))
    expect(res._status).toBe(409)
  })

  it('should return 201 on successful creation', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: 'emp-1' } })
    const created = { id: 'ts-new', employeeId: 'emp-1', weekStart: new Date('2025-01-06'), status: 'draft' }
    mockDbCreate.mockResolvedValue(created)
    const res = await POST(makePostRequest({ weekStart: '2025-01-06' }))
    expect(res._status).toBe(201)
    expect((res._data as any).timesheet).toEqual(created)
  })
})
