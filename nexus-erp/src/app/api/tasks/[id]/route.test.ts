import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockGetTask } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockGetTask: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/workflow', () => ({ getTask: mockGetTask }))
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

const PARAMS = { params: Promise.resolve({ id: 'task-1' }) }

function makeRequest() {
  return new NextRequest('http://localhost/api/tasks/task-1')
}

describe('GET /api/tasks/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 403 when no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest(), PARAMS)
    expect(res._status).toBe(403)
    expect((res._data as any).error).toBe('Forbidden')
  })

  it('should return 404 when getTask throws', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    mockGetTask.mockRejectedValue(new Error('not found'))
    const res = await GET(makeRequest(), PARAMS)
    expect(res._status).toBe(404)
    expect((res._data as any).error).toBe('Task not found')
  })

  it('should return 200 with task data on success (manager session)', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const taskData = { task: { id: 'task-1', elementId: 'task_manager_review' }, variables: {} }
    mockGetTask.mockResolvedValue(taskData)
    const res = await GET(makeRequest(), PARAMS)
    expect(res._status).toBe(200)
    expect(res._data).toEqual(taskData)
  })
})
