import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockAuth,
  mockStartInstance,
  mockDbFindFirst,
  mockDbUpdate,
  mockDbCreate,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockStartInstance: vi.fn(),
  mockDbFindFirst: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbCreate: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/workflow', () => ({ startInstance: mockStartInstance }))
vi.mock('@/db/client', () => ({
  db: {
    employeeProfileUpdateRequest: {
      findFirst: mockDbFindFirst,
      update: mockDbUpdate,
      create: mockDbCreate,
    },
  },
}))
vi.mock('next/server', () => {
  class MockNextRequest {
    private _body: unknown
    constructor(_url: string, init?: { body?: string }) {
      this._body = init?.body ? JSON.parse(init.body) : {}
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

const PARAMS = { params: Promise.resolve({ id: 'emp-1' }) }

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/employees/emp-1/profile-update-requests', {
    body: JSON.stringify(body),
  })
}

const CONTACT_BODY = { phone: '555-0100', street: '1 Main St', city: 'Springfield', state: 'IL', postalCode: '62701', country: 'US' }

describe('POST /api/employees/[id]/profile-update-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 when no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest(CONTACT_BODY), PARAMS)
    expect(res._status).toBe(401)
  })

  it('should return 403 when employee submits for another employee profile', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'employee', employeeId: 'emp-other' } })
    const res = await POST(makeRequest(CONTACT_BODY), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 200 and update in place when a PENDING request already exists', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'employee', employeeId: 'emp-1' } })
    const existingRequest = { id: 'req-existing', employeeId: 'emp-1', status: 'PENDING', workflowInstanceId: 'wf-inst-1' }
    const updatedRequest = { ...existingRequest, phone: '555-0100' }
    mockDbFindFirst.mockResolvedValue(existingRequest)
    mockDbUpdate.mockResolvedValue(updatedRequest)

    const res = await POST(makeRequest(CONTACT_BODY), PARAMS)

    expect(res._status).toBe(200)
    const data = res._data as any
    expect(data.workflowInstanceId).toBe('wf-inst-1')
    expect(data.request).toEqual(updatedRequest)
    expect(mockDbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'req-existing' } })
    )
    expect(mockStartInstance).not.toHaveBeenCalled()
  })

  it('should return 201, create request, call startInstance, and patch workflowInstanceId when no existing request', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'employee', employeeId: 'emp-1' } })
    const createdRequest = { id: 'req-new', employeeId: 'emp-1', status: 'PENDING', workflowInstanceId: null }
    const workflowInstance = { id: 'wf-inst-new' }
    mockDbFindFirst.mockResolvedValue(null)
    mockDbCreate.mockResolvedValue(createdRequest)
    mockStartInstance.mockResolvedValue(workflowInstance)
    mockDbUpdate.mockResolvedValue({ ...createdRequest, workflowInstanceId: 'wf-inst-new' })

    const res = await POST(makeRequest(CONTACT_BODY), PARAMS)

    expect(res._status).toBe(201)
    const data = res._data as any
    expect(data.workflowInstanceId).toBe('wf-inst-new')
    expect(data.request).toEqual(createdRequest)
    expect(mockDbCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ employeeId: 'emp-1' }) })
    )
    expect(mockStartInstance).toHaveBeenCalledWith(
      'update-profile-info',
      expect.objectContaining({ updateRequestId: 'req-new', employeeId: 'emp-1' }),
      'profile-update-req-new',
    )
    expect(mockDbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'req-new' },
        data: { workflowInstanceId: 'wf-inst-new' },
      })
    )
  })
})
