import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockAuth,
  mockGetTask,
  mockCompleteTask,
  mockDbTsFindFirst,
  mockDbTsUpdate,
  mockDbOrgFindFirst,
  mockDbOrgUpdate,
  mockDbPRFindUnique,
  mockDbPRUpdate,
  mockDbEmpUpdate,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockGetTask: vi.fn(),
  mockCompleteTask: vi.fn(),
  mockDbTsFindFirst: vi.fn(),
  mockDbTsUpdate: vi.fn(),
  mockDbOrgFindFirst: vi.fn(),
  mockDbOrgUpdate: vi.fn(),
  mockDbPRFindUnique: vi.fn(),
  mockDbPRUpdate: vi.fn(),
  mockDbEmpUpdate: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/workflow', () => ({ getTask: mockGetTask, completeTask: mockCompleteTask }))
vi.mock('@/db/client', () => ({
  db: {
    timesheet: { findFirst: mockDbTsFindFirst, update: mockDbTsUpdate },
    organization: { findFirst: mockDbOrgFindFirst, update: mockDbOrgUpdate },
    employeeProfileUpdateRequest: { findUnique: mockDbPRFindUnique, update: mockDbPRUpdate },
    employee: { update: mockDbEmpUpdate },
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

const PARAMS = { params: Promise.resolve({ id: 'task-1' }) }

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/tasks/task-1/complete', {
    body: JSON.stringify(body),
  })
}

const BASE_TASK = {
  task: { id: 'task-1', instanceId: 'inst-1', elementId: 'task_manager_review' },
  variables: {},
}

describe('POST /api/tasks/[id]/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCompleteTask.mockResolvedValue(undefined)
    mockDbTsFindFirst.mockResolvedValue(null)
    mockDbOrgFindFirst.mockResolvedValue(null)
    mockDbPRFindUnique.mockResolvedValue(null)
  })

  it('should return 401 when no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest({ decision: 'approved' }), PARAMS)
    expect(res._status).toBe(401)
    expect((res._data as any).error).toBe('Unauthorized')
  })

  it('should return 400 for an invalid decision value', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'manager' } })
    const res = await POST(makeRequest({ decision: 'maybe' }), PARAMS)
    expect(res._status).toBe(400)
  })

  it('should return 404 when getTask throws', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'manager' } })
    mockGetTask.mockRejectedValue(new Error('not found'))
    const res = await POST(makeRequest({ decision: 'approved' }), PARAMS)
    expect(res._status).toBe(404)
    expect((res._data as any).error).toBe('Task not found')
  })

  it('should return 200 and update timesheet to pending_hr_review when manager approves', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'manager' } })
    mockGetTask.mockResolvedValue({
      ...BASE_TASK,
      variables: { timesheetId: 'ts-1' },
    })
    const timesheet = { id: 'ts-1', workflowInstanceId: 'inst-1' }
    mockDbTsFindFirst.mockResolvedValue(timesheet)

    const res = await POST(makeRequest({ decision: 'approved' }), PARAMS)
    expect(res._status).toBe(200)
    expect((res._data as any).decision).toBe('approved')
    expect(mockDbTsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ts-1' },
        data: expect.objectContaining({ status: 'pending_hr_review' }),
      }),
    )
  })

  it('should return 200 and update organization status when organizationId variable is set', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'manager' } })
    mockGetTask.mockResolvedValue({
      ...BASE_TASK,
      variables: { organizationId: 'org-1', requestedStatus: 'active' },
    })
    const org = { id: 'org-1', workflowInstanceId: 'inst-1' }
    mockDbOrgFindFirst.mockResolvedValue(org)

    const res = await POST(makeRequest({ decision: 'approved' }), PARAMS)
    expect(res._status).toBe(200)
    expect(mockDbOrgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'org-1' },
        data: expect.objectContaining({ status: 'active' }),
      }),
    )
  })

  it('should return 200, update employee, and approve profileUpdateRequest when approved', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'manager' } })
    mockGetTask.mockResolvedValue({
      ...BASE_TASK,
      variables: { updateRequestId: 'req-1' },
    })
    const request = {
      id: 'req-1',
      employeeId: 'emp-1',
      status: 'PENDING',
      phone: '555-0100',
      street: null,
      city: null,
      state: null,
      postalCode: null,
      country: null,
    }
    mockDbPRFindUnique.mockResolvedValue(request)

    const res = await POST(makeRequest({ decision: 'approved' }), PARAMS)
    expect(res._status).toBe(200)
    expect(mockDbEmpUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'emp-1' } }),
    )
    expect(mockDbPRUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'req-1' },
        data: expect.objectContaining({ status: 'APPROVED' }),
      }),
    )
  })
})
