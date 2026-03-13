import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockAuth,
  mockDbFindUnique,
  mockDbEntryFindUnique,
  mockDbEntryUpdate,
  mockDbEntryDelete,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDbFindUnique: vi.fn(),
  mockDbEntryFindUnique: vi.fn(),
  mockDbEntryUpdate: vi.fn(),
  mockDbEntryDelete: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/db/client', () => ({
  db: {
    timesheet: { findUnique: mockDbFindUnique },
    timesheetEntry: {
      findUnique: mockDbEntryFindUnique,
      update: mockDbEntryUpdate,
      delete: mockDbEntryDelete,
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
import { PUT, DELETE } from './route'

const TS = { id: 'ts-1', employeeId: 'emp-1', status: 'draft' }
const ENTRY = { id: 'entry-1', timesheetId: 'ts-1', date: new Date('2025-01-06'), hours: 8, projectCode: null, description: null }
const PARAMS = { params: Promise.resolve({ id: 'ts-1', entryId: 'entry-1' }) }

function makePutRequest(body: unknown) {
  return new NextRequest('http://localhost/api/timesheets/ts-1/entries/entry-1', {
    body: JSON.stringify(body),
  })
}

function makeDeleteRequest() {
  return new NextRequest('http://localhost/api/timesheets/ts-1/entries/entry-1')
}

describe('PUT /api/timesheets/[id]/entries/[entryId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 when session has no employeeId', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: null } })
    const res = await PUT(makePutRequest({ hours: 6 }), PARAMS)
    expect(res._status).toBe(401)
  })

  it('should return 404 when timesheet not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: 'emp-1' } })
    mockDbFindUnique.mockResolvedValue(null)
    const res = await PUT(makePutRequest({ hours: 6 }), PARAMS)
    expect(res._status).toBe(404)
  })

  it('should return 200 with updated entry on success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: 'emp-1' } })
    mockDbFindUnique.mockResolvedValue(TS)
    mockDbEntryFindUnique.mockResolvedValue(ENTRY)
    const updated = { ...ENTRY, hours: 6 }
    mockDbEntryUpdate.mockResolvedValue(updated)

    const res = await PUT(makePutRequest({ hours: 6 }), PARAMS)
    expect(res._status).toBe(200)
    expect((res._data as any).entry).toEqual(updated)
    expect(mockDbEntryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'entry-1' },
        data: expect.objectContaining({ hours: 6 }),
      }),
    )
  })
})

describe('DELETE /api/timesheets/[id]/entries/[entryId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 when session has no employeeId', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: null } })
    const res = await DELETE(makeDeleteRequest(), PARAMS)
    expect(res._status).toBe(401)
  })

  it('should return 204 on successful deletion', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: 'emp-1' } })
    mockDbFindUnique.mockResolvedValue(TS)
    mockDbEntryFindUnique.mockResolvedValue(ENTRY)
    mockDbEntryDelete.mockResolvedValue(ENTRY)

    const res = await DELETE(makeDeleteRequest(), PARAMS)
    expect(res._status).toBe(204)
    expect(mockDbEntryDelete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'entry-1' } }),
    )
  })
})
