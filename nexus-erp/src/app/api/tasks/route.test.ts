import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockAuth,
  mockListTasks,
  mockGetEffectivePermissions,
  mockDbTimesheetFindFirst,
  mockDbOrgFindFirst,
  mockDbProfileFindFirst,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockListTasks: vi.fn(),
  mockGetEffectivePermissions: vi.fn(),
  mockDbTimesheetFindFirst: vi.fn(),
  mockDbOrgFindFirst: vi.fn(),
  mockDbProfileFindFirst: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/workflow', () => ({ listTasks: mockListTasks }))
vi.mock('@/lib/permissions', () => ({ getEffectivePermissions: mockGetEffectivePermissions }))
vi.mock('@/db/client', () => ({
  db: {
    timesheet: { findFirst: mockDbTimesheetFindFirst },
    organization: { findFirst: mockDbOrgFindFirst },
    employeeProfileUpdateRequest: { findFirst: mockDbProfileFindFirst },
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

function makeRequest(params?: Record<string, string>) {
  const url = new URL('http://localhost/api/tasks')
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  }
  return new NextRequest(url.toString())
}

describe('GET /api/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetEffectivePermissions.mockResolvedValue([])
    mockDbTimesheetFindFirst.mockResolvedValue(null)
    mockDbOrgFindFirst.mockResolvedValue(null)
    mockDbProfileFindFirst.mockResolvedValue(null)
  })

  it('should return 401 when no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest())
    expect(res._status).toBe(401)
    expect((res._data as any).error).toBe('Unauthorized')
  })

  it('should return 200 and deduplicate tasks returned by multiple patterns', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee' } })
    mockGetEffectivePermissions.mockResolvedValue(['can_view'])

    const task = { id: 'task-1', instanceId: 'inst-1', name: 'Review' }
    // All three patterns (userId, role:employee, perm:can_view) return the same task
    mockListTasks.mockResolvedValue({ items: [task], total: 1 })

    const res = await GET(makeRequest())
    expect(res._status).toBe(200)
    const data = res._data as any
    // Should appear only once despite being returned by 3 patterns
    expect(data.items).toHaveLength(1)
    expect(data.items[0].id).toBe('task-1')
    expect(data.total).toBe(1)
  })

  it('should return 200 and enrich task with entityType timesheet when timesheet found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee' } })
    mockGetEffectivePermissions.mockResolvedValue([])

    const task = { id: 'task-1', instanceId: 'inst-1' }
    mockListTasks.mockImplementation(({ assignee }: { assignee: string }) => {
      if (assignee === 'user-1') return Promise.resolve({ items: [task], total: 1 })
      return Promise.resolve({ items: [], total: 0 })
    })

    const timesheet = { id: 'ts-1', workflowInstanceId: 'inst-1', employee: { user: { email: 'a@b.com' } } }
    mockDbTimesheetFindFirst.mockResolvedValue(timesheet)

    const res = await GET(makeRequest())
    expect(res._status).toBe(200)
    const data = res._data as any
    expect(data.items).toHaveLength(1)
    expect(data.items[0].entityType).toBe('timesheet')
    expect(data.items[0].timesheet).toEqual(timesheet)
  })

  it('should return 200 with entityType null when no entity found for task', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee' } })
    mockGetEffectivePermissions.mockResolvedValue([])

    const task = { id: 'task-1', instanceId: 'inst-1' }
    mockListTasks.mockImplementation(({ assignee }: { assignee: string }) => {
      if (assignee === 'user-1') return Promise.resolve({ items: [task], total: 1 })
      return Promise.resolve({ items: [], total: 0 })
    })

    // All entity lookups return null (defaults from beforeEach)

    const res = await GET(makeRequest())
    expect(res._status).toBe(200)
    const data = res._data as any
    expect(data.items).toHaveLength(1)
    expect(data.items[0].entityType).toBeNull()
    expect(data.items[0].entity).toBeNull()
    expect(data.items[0].timesheet).toBeNull()
  })
})
