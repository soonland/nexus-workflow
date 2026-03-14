import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockAuth,
  mockStartInstance,
  mockDbFindUnique,
  mockDbUpdate,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockStartInstance: vi.fn(),
  mockDbFindUnique: vi.fn(),
  mockDbUpdate: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/workflow', () => ({ startInstance: mockStartInstance }))
vi.mock('@/db/client', () => ({
  db: {
    timesheet: { findUnique: mockDbFindUnique, update: mockDbUpdate },
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

function makeRequest() {
  return new NextRequest('http://localhost/api/timesheets/ts-1/submit')
}

const MANAGER_USER = { id: 'user-mgr-1' }
const EMPLOYEE_MANAGER = { user: MANAGER_USER }
const BASE_TS = {
  id: 'ts-1',
  employeeId: 'emp-1',
  status: 'draft',
  weekStart: new Date('2025-01-06'),
  entries: [{ hours: 8 }],
  employee: { manager: EMPLOYEE_MANAGER },
}

describe('POST /api/timesheets/[id]/submit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 when session has no employeeId', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: null } })
    const res = await POST(makeRequest(), PARAMS)
    expect(res._status).toBe(401)
  })

  it('should return 404 when timesheet not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: 'emp-1' } })
    mockDbFindUnique.mockResolvedValue(null)
    const res = await POST(makeRequest(), PARAMS)
    expect(res._status).toBe(404)
  })

  it('should return 403 when session employee does not own the timesheet', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-2', role: 'employee', employeeId: 'emp-other' } })
    mockDbFindUnique.mockResolvedValue(BASE_TS)
    const res = await POST(makeRequest(), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 422 when timesheet status is not draft or revision_requested', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: 'emp-1' } })
    mockDbFindUnique.mockResolvedValue({ ...BASE_TS, status: 'submitted' })
    const res = await POST(makeRequest(), PARAMS)
    expect(res._status).toBe(422)
  })

  it('should return 422 when timesheet has no manager assigned', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: 'emp-1' } })
    mockDbFindUnique.mockResolvedValue({
      ...BASE_TS,
      employee: { manager: null },
    })
    const res = await POST(makeRequest(), PARAMS)
    expect(res._status).toBe(422)
  })

  it('should return 422 when timesheet has no entries', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: 'emp-1' } })
    mockDbFindUnique.mockResolvedValue({ ...BASE_TS, entries: [] })
    const res = await POST(makeRequest(), PARAMS)
    expect(res._status).toBe(422)
  })

  it('should return 200, call startInstance, and update timesheet to pending_manager_review', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: 'emp-1' } })
    mockDbFindUnique.mockResolvedValue(BASE_TS)
    const workflowInstance = { id: 'wf-inst-1' }
    mockStartInstance.mockResolvedValue(workflowInstance)
    const updatedTs = { ...BASE_TS, status: 'pending_manager_review', workflowInstanceId: 'wf-inst-1' }
    mockDbUpdate.mockResolvedValue(updatedTs)

    const res = await POST(makeRequest(), PARAMS)
    expect(res._status).toBe(200)
    expect(mockStartInstance).toHaveBeenCalledWith(
      'timesheet-approval',
      expect.objectContaining({ timesheetId: 'ts-1', managerId: 'user-mgr-1' }),
      expect.stringContaining('timesheet-ts-1'),
    )
    expect(mockDbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ts-1' },
        data: expect.objectContaining({ status: 'pending_manager_review' }),
      }),
    )
    expect((res._data as any).timesheet).toEqual(updatedTs)
  })
})
