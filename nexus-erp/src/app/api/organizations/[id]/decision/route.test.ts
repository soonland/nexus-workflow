import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockListTasks, mockGetTask, mockCompleteTask, mockGetInstance, mockDbFindUnique, mockDbUpdate, mockDbAuditLogCreate } =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockListTasks: vi.fn(),
    mockGetTask: vi.fn(),
    mockCompleteTask: vi.fn(),
    mockGetInstance: vi.fn(),
    mockDbFindUnique: vi.fn(),
    mockDbUpdate: vi.fn(),
    mockDbAuditLogCreate: vi.fn().mockResolvedValue({}),
  }))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/workflow', () => ({
  listTasks: mockListTasks,
  getTask: mockGetTask,
  completeTask: mockCompleteTask,
  getInstance: mockGetInstance,
}))
vi.mock('@/db/client', () => ({
  db: {
    organization: {
      findUnique: mockDbFindUnique,
      update: mockDbUpdate,
    },
    auditLog: { create: mockDbAuditLogCreate },
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
import { POST } from './route'

const params = Promise.resolve({ id: 'org-1' })

const ORG_WITH_INSTANCE = { id: 'org-1', workflowInstanceId: 'inst-1' }
const OPEN_TASK = { id: 'task-1', instanceId: 'inst-1', elementId: 'await-manager-decision' }

describe('POST /api/organizations/[id]/decision', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('should return 403 when no session', async () => {
    mockAuth.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/organizations/org-1/decision', {
      body: JSON.stringify({ decision: 'approved' }),
    })
    const res = await POST(req, { params })

    expect(res._status).toBe(403)
    expect(res._data).toEqual({ error: 'Forbidden' })
  })

  it('should return 404 when organization not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'manager' } })
    mockDbFindUnique.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/organizations/org-1/decision', {
      body: JSON.stringify({ decision: 'approved' }),
    })
    const res = await POST(req, { params })

    expect(res._status).toBe(404)
    expect(res._data).toEqual({ error: 'Not found' })
  })

  it('should return 409 when organization has no workflowInstanceId', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'manager' } })
    mockDbFindUnique.mockResolvedValue({ id: 'org-1', workflowInstanceId: null })

    const req = new NextRequest('http://localhost/api/organizations/org-1/decision', {
      body: JSON.stringify({ decision: 'approved' }),
    })
    const res = await POST(req, { params })

    expect(res._status).toBe(409)
    expect(res._data).toEqual({ error: 'No pending status change request' })
  })

  it('should return 410 when no open task and instance is not active', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'manager' } })
    mockDbFindUnique.mockResolvedValue(ORG_WITH_INSTANCE)
    // listTasks returns items but none match the instance+elementId combo
    mockListTasks.mockResolvedValue({ items: [] })
    mockGetInstance.mockResolvedValue({ instance: { status: 'completed' } })
    mockDbUpdate.mockResolvedValue({})

    const req = new NextRequest('http://localhost/api/organizations/org-1/decision', {
      body: JSON.stringify({ decision: 'approved' }),
    })
    const res = await POST(req, { params })

    expect(res._status).toBe(410)
    expect(res._data).toEqual({ error: 'Status change request has expired' })
    expect(mockDbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'org-1' },
        data: { workflowInstanceId: null, statusChangeReason: null },
      }),
    )
  })

  it('should return 200 when approved with requestedStatus and update org status', async () => {
    const session = { user: { id: 'user-1', role: 'manager' } }
    mockAuth.mockResolvedValue(session)
    mockDbFindUnique.mockResolvedValue(ORG_WITH_INSTANCE)
    mockListTasks.mockResolvedValue({ items: [OPEN_TASK] })
    mockGetTask.mockResolvedValue({
      task: OPEN_TASK,
      variables: { requestedStatus: 'active' },
    })
    mockDbUpdate.mockResolvedValue({})
    mockCompleteTask.mockResolvedValue({})

    const req = new NextRequest('http://localhost/api/organizations/org-1/decision', {
      body: JSON.stringify({ decision: 'approved' }),
    })
    const res = await POST(req, { params })

    expect(res._status).toBe(200)
    expect(res._data).toEqual({ success: true, decision: 'approved' })
    expect(mockDbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'org-1' },
        data: expect.objectContaining({ status: 'active', workflowInstanceId: null }),
      }),
    )
    expect(mockCompleteTask).toHaveBeenCalledWith(
      'task-1',
      'user-1',
      expect.objectContaining({ decision: 'approved' }),
    )
  })
})
