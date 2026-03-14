import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockDbFindUnique, mockDbEntryCreate } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDbFindUnique: vi.fn(),
  mockDbEntryCreate: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/db/client', () => ({
  db: {
    timesheet: { findUnique: mockDbFindUnique },
    timesheetEntry: { create: mockDbEntryCreate },
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
import { POST } from './route'

const PARAMS = { params: Promise.resolve({ id: 'ts-1' }) }

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/timesheets/ts-1/entries', {
    body: JSON.stringify(body),
  })
}

const VALID_ENTRY_BODY = { date: '2025-01-06', hours: 8, projectCode: 'P1', description: null }
const BASE_TS = { id: 'ts-1', employeeId: 'emp-1', status: 'draft' }

describe('POST /api/timesheets/[id]/entries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 when session has no employeeId', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: null } })
    const res = await POST(makeRequest(VALID_ENTRY_BODY), PARAMS)
    expect(res._status).toBe(401)
  })

  it('should return 403 when employee does not own the timesheet', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2', role: 'employee', employeeId: 'emp-other' } })
    mockDbFindUnique.mockResolvedValue(BASE_TS)
    const res = await POST(makeRequest(VALID_ENTRY_BODY), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 422 when timesheet is not editable (status submitted)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: 'emp-1' } })
    mockDbFindUnique.mockResolvedValue({ ...BASE_TS, status: 'submitted' })
    const res = await POST(makeRequest(VALID_ENTRY_BODY), PARAMS)
    expect(res._status).toBe(422)
  })

  it('should return 400 when body is invalid (hours=-1)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: 'emp-1' } })
    mockDbFindUnique.mockResolvedValue(BASE_TS)
    const res = await POST(makeRequest({ date: '2025-01-06', hours: -1 }), PARAMS)
    expect(res._status).toBe(400)
  })

  it('should return 201 on successful entry creation', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: 'emp-1' } })
    mockDbFindUnique.mockResolvedValue(BASE_TS)
    const created = { id: 'entry-1', timesheetId: 'ts-1', date: new Date('2025-01-06'), hours: 8, projectCode: 'P1', description: null }
    mockDbEntryCreate.mockResolvedValue(created)

    const res = await POST(makeRequest(VALID_ENTRY_BODY), PARAMS)
    expect(res._status).toBe(201)
    expect((res._data as any).entry).toEqual(created)
    expect(mockDbEntryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ timesheetId: 'ts-1', hours: 8 }),
      }),
    )
  })
})
