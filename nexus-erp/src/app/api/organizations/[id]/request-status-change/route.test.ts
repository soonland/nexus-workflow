import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockStartInstance, mockCancelInstance, mockDbFindUnique, mockDbUpdate } = vi.hoisted(
  () => ({
    mockAuth: vi.fn(),
    mockStartInstance: vi.fn(),
    mockCancelInstance: vi.fn(),
    mockDbFindUnique: vi.fn(),
    mockDbUpdate: vi.fn(),
  }),
)

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/workflow', () => ({
  startInstance: mockStartInstance,
  cancelInstance: mockCancelInstance,
}))
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
import { POST, DELETE } from './route'

const params = Promise.resolve({ id: 'org-1' })

const ORG_NO_INSTANCE = {
  id: 'org-1',
  ownerId: 'emp-1',
  status: 'active',
  workflowInstanceId: null,
  owner: { id: 'emp-1', userId: 'user-1' },
}

const SESSION = { user: { id: 'user-1', role: 'employee', employeeId: 'emp-1' } }

describe('POST /api/organizations/[id]/request-status-change', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('should return 401 when no employeeId in session', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: null } })

    const req = new NextRequest('http://localhost/api/organizations/org-1/request-status-change', {
      body: JSON.stringify({ requestedStatus: 'inactive', statusChangeReason: 'Going on leave' }),
    })
    const res = await POST(req, { params })

    expect(res._status).toBe(401)
    expect(res._data).toEqual({ error: 'Unauthorized' })
  })

  it('should return 403 when org.ownerId does not match session employeeId', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockDbFindUnique.mockResolvedValue({ ...ORG_NO_INSTANCE, ownerId: 'emp-other' })

    const req = new NextRequest('http://localhost/api/organizations/org-1/request-status-change', {
      body: JSON.stringify({ requestedStatus: 'inactive', statusChangeReason: 'Going on leave' }),
    })
    const res = await POST(req, { params })

    expect(res._status).toBe(403)
    expect(res._data).toEqual({ error: 'Forbidden' })
  })

  it('should return 409 when a workflowInstanceId already exists', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockDbFindUnique.mockResolvedValue({ ...ORG_NO_INSTANCE, workflowInstanceId: 'inst-existing' })

    const req = new NextRequest('http://localhost/api/organizations/org-1/request-status-change', {
      body: JSON.stringify({ requestedStatus: 'inactive', statusChangeReason: 'Going on leave' }),
    })
    const res = await POST(req, { params })

    expect(res._status).toBe(409)
    expect(res._data).toEqual({ error: 'A status change request is already in progress' })
  })

  it('should return 200 on success, call startInstance and update db with workflowInstanceId', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockDbFindUnique.mockResolvedValue(ORG_NO_INSTANCE)
    mockStartInstance.mockResolvedValue({ id: 'inst-new' })
    mockDbUpdate.mockResolvedValue({})

    const req = new NextRequest('http://localhost/api/organizations/org-1/request-status-change', {
      body: JSON.stringify({ requestedStatus: 'inactive', statusChangeReason: 'Going on leave' }),
    })
    const res = await POST(req, { params })

    expect(res._status).toBe(200)
    expect(res._data).toEqual({ workflowInstanceId: 'inst-new' })
    expect(mockStartInstance).toHaveBeenCalledWith(
      'org-status-change',
      expect.objectContaining({
        organizationId: 'org-1',
        requestedStatus: 'inactive',
        statusChangeReason: 'Going on leave',
        requestedByUserId: 'user-1',
      }),
      expect.any(String),
    )
    expect(mockDbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'org-1' },
        data: expect.objectContaining({ workflowInstanceId: 'inst-new' }),
      }),
    )
  })
})

describe('DELETE /api/organizations/[id]/request-status-change', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('should return 200 on success, call cancelInstance and clear workflowInstanceId', async () => {
    mockAuth.mockResolvedValue(SESSION)
    mockDbFindUnique.mockResolvedValue({
      id: 'org-1',
      ownerId: 'emp-1',
      workflowInstanceId: 'inst-1',
    })
    mockCancelInstance.mockResolvedValue({})
    mockDbUpdate.mockResolvedValue({})

    const req = new NextRequest('http://localhost/api/organizations/org-1/request-status-change')
    const res = await DELETE(req, { params })

    expect(res._status).toBe(200)
    expect(res._data).toEqual({ cancelled: true })
    expect(mockCancelInstance).toHaveBeenCalledWith('inst-1')
    expect(mockDbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'org-1' },
        data: { workflowInstanceId: null, statusChangeReason: null },
      }),
    )
  })
})
