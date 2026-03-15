import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockDbAuditLogCount, mockDbAuditLogFindMany } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDbAuditLogCount: vi.fn(),
  mockDbAuditLogFindMany: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/db/client', () => ({
  db: {
    auditLog: {
      count: mockDbAuditLogCount,
      findMany: mockDbAuditLogFindMany,
    },
  },
}))

vi.mock('next/server', () => {
  class MockNextRequest {
    nextUrl: { searchParams: URLSearchParams }
    constructor(url: string) {
      const queryString = url.includes('?') ? url.split('?')[1] : ''
      this.nextUrl = { searchParams: new URLSearchParams(queryString) }
    }
  }
  const NextResponse = {
    json: (data: unknown, init?: { status?: number }) => ({
      _data: data,
      _status: init?.status ?? 200,
    }),
  }
  return { NextRequest: MockNextRequest, NextResponse }
})

import { NextRequest } from 'next/server'
import { GET } from './route'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeRequest(query = '') {
  const url = `http://localhost/api/audit-log${query ? `?${query}` : ''}`
  return new NextRequest(url) as unknown as import('next/server').NextRequest
}

const SAMPLE_ENTRIES = [
  {
    id: 'log-1',
    entityType: 'Employee',
    entityId: 'emp-1',
    action: 'CREATE',
    actorId: 'user-1',
    actorName: 'Alice',
    before: null,
    after: { fullName: 'Alice' },
    createdAt: new Date('2024-06-01T10:00:00Z'),
  },
  {
    id: 'log-2',
    entityType: 'Timesheet',
    entityId: 'ts-1',
    action: 'UPDATE',
    actorId: 'user-2',
    actorName: 'Bob',
    before: { status: 'draft' },
    after: { status: 'submitted' },
    createdAt: new Date('2024-06-02T12:00:00Z'),
  },
]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/audit-log', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbAuditLogCount.mockResolvedValue(0)
    mockDbAuditLogFindMany.mockResolvedValue([])
  })

  // ── Auth guards ──────────────────────────────────────────────────────────────

  it('should return 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest())
    expect(res._status).toBe(401)
    expect((res._data as any).error).toBe('Unauthorized')
  })

  it('should return 403 when session role is employee', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'employee' } })
    const res = await GET(makeRequest())
    expect(res._status).toBe(403)
    expect((res._data as any).error).toBe('Forbidden')
  })

  it('should not call db when session is missing', async () => {
    mockAuth.mockResolvedValue(null)
    await GET(makeRequest())
    expect(mockDbAuditLogCount).not.toHaveBeenCalled()
    expect(mockDbAuditLogFindMany).not.toHaveBeenCalled()
  })

  it('should not call db when role is not manager', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'employee' } })
    await GET(makeRequest())
    expect(mockDbAuditLogCount).not.toHaveBeenCalled()
    expect(mockDbAuditLogFindMany).not.toHaveBeenCalled()
  })

  // ── Empty results ────────────────────────────────────────────────────────────

  it('should return 200 with empty entries array when there are no audit logs', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    mockDbAuditLogCount.mockResolvedValue(0)
    mockDbAuditLogFindMany.mockResolvedValue([])

    const res = await GET(makeRequest())
    expect(res._status).toBe(200)
    const data = res._data as any
    expect(data.entries).toEqual([])
    expect(data.total).toBe(0)
    expect(data.page).toBe(1)
    expect(data.pageSize).toBe(25)
    expect(data.totalPages).toBe(0)
  })

  // ── Response shape ───────────────────────────────────────────────────────────

  it('should return correct pagination shape with results', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    mockDbAuditLogCount.mockResolvedValue(50)
    mockDbAuditLogFindMany.mockResolvedValue(SAMPLE_ENTRIES)

    const res = await GET(makeRequest())
    expect(res._status).toBe(200)
    const data = res._data as any
    expect(data.entries).toHaveLength(2)
    expect(data.total).toBe(50)
    expect(data.page).toBe(1)
    expect(data.pageSize).toBe(25)
    expect(data.totalPages).toBe(2)
  })

  it('should compute totalPages correctly when total is an exact multiple of pageSize', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    mockDbAuditLogCount.mockResolvedValue(75)
    mockDbAuditLogFindMany.mockResolvedValue([])

    const res = await GET(makeRequest())
    expect((res._data as any).totalPages).toBe(3)
  })

  it('should compute totalPages correctly when total is not an exact multiple of pageSize', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    mockDbAuditLogCount.mockResolvedValue(26)
    mockDbAuditLogFindMany.mockResolvedValue([])

    const res = await GET(makeRequest())
    expect((res._data as any).totalPages).toBe(2)
  })

  // ── Pagination ───────────────────────────────────────────────────────────────

  it('should use page=1 when no page param is provided', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await GET(makeRequest())

    expect(mockDbAuditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 25 }),
    )
  })

  it('should skip the correct number of entries for page=2', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await GET(makeRequest('page=2'))

    expect(mockDbAuditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 25, take: 25 }),
    )
  })

  it('should clamp page to 1 when page=0 is provided', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await GET(makeRequest('page=0'))

    expect((res._data as any).page).toBe(1)
    expect(mockDbAuditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0 }),
    )
  })

  it('should return correct page number in response body', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await GET(makeRequest('page=3'))

    expect((res._data as any).page).toBe(3)
  })

  // ── Filters — entityType ─────────────────────────────────────────────────────

  it('should filter by a single entityType when provided', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await GET(makeRequest('entityType=Employee'))

    expect(mockDbAuditLogCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ entityType: { in: ['Employee'] } }) }),
    )
    expect(mockDbAuditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ entityType: { in: ['Employee'] } }) }),
    )
  })

  it('should filter by multiple entityType values when provided', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await GET(makeRequest('entityType=Employee&entityType=Timesheet'))

    const whereArg = mockDbAuditLogCount.mock.calls[0][0].where
    expect(whereArg.entityType).toEqual({ in: ['Employee', 'Timesheet'] })
  })

  it('should not include entityType filter when entityType param is absent', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await GET(makeRequest())

    const whereArg = mockDbAuditLogCount.mock.calls[0][0].where
    expect(whereArg).not.toHaveProperty('entityType')
  })

  // ── Filters — action ─────────────────────────────────────────────────────────

  it('should filter by a single valid action when provided', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await GET(makeRequest('action=CREATE'))

    const whereArg = mockDbAuditLogCount.mock.calls[0][0].where
    expect(whereArg.action).toEqual({ in: ['CREATE'] })
  })

  it('should filter by multiple valid actions when provided', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await GET(makeRequest('action=CREATE&action=DELETE'))

    const whereArg = mockDbAuditLogCount.mock.calls[0][0].where
    expect(whereArg.action).toEqual({ in: ['CREATE', 'DELETE'] })
  })

  it('should strip invalid action values and not include action filter when all are invalid', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await GET(makeRequest('action=INVALID&action=UNKNOWN'))

    const whereArg = mockDbAuditLogCount.mock.calls[0][0].where
    expect(whereArg).not.toHaveProperty('action')
  })

  it('should only include valid actions and discard invalid ones in a mixed list', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await GET(makeRequest('action=CREATE&action=INVALID'))

    const whereArg = mockDbAuditLogCount.mock.calls[0][0].where
    expect(whereArg.action).toEqual({ in: ['CREATE'] })
  })

  it('should not include action filter when action param is absent', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await GET(makeRequest())

    const whereArg = mockDbAuditLogCount.mock.calls[0][0].where
    expect(whereArg).not.toHaveProperty('action')
  })

  // ── Filters — actorId ────────────────────────────────────────────────────────

  it('should filter by actorId when provided', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await GET(makeRequest('actorId=user-42'))

    const whereArg = mockDbAuditLogCount.mock.calls[0][0].where
    expect(whereArg.actorId).toBe('user-42')
  })

  it('should not include actorId filter when actorId param is absent', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await GET(makeRequest())

    const whereArg = mockDbAuditLogCount.mock.calls[0][0].where
    expect(whereArg).not.toHaveProperty('actorId')
  })

  // ── Filters — entityId ───────────────────────────────────────────────────────

  it('should filter by entityId when provided', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await GET(makeRequest('entityId=emp-99'))

    const whereArg = mockDbAuditLogCount.mock.calls[0][0].where
    expect(whereArg.entityId).toBe('emp-99')
  })

  it('should not include entityId filter when entityId param is absent', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await GET(makeRequest())

    const whereArg = mockDbAuditLogCount.mock.calls[0][0].where
    expect(whereArg).not.toHaveProperty('entityId')
  })

  // ── Filters — date range ─────────────────────────────────────────────────────

  it('should filter by from date when provided', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await GET(makeRequest('from=2024-01-01'))

    const whereArg = mockDbAuditLogCount.mock.calls[0][0].where
    expect(whereArg.createdAt).toEqual({ gte: new Date('2024-01-01') })
  })

  it('should filter by to date when provided', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await GET(makeRequest('to=2024-12-31'))

    const whereArg = mockDbAuditLogCount.mock.calls[0][0].where
    expect(whereArg.createdAt).toEqual({ lte: new Date('2024-12-31') })
  })

  it('should filter by both from and to dates when both are provided', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await GET(makeRequest('from=2024-01-01&to=2024-12-31'))

    const whereArg = mockDbAuditLogCount.mock.calls[0][0].where
    expect(whereArg.createdAt).toEqual({
      gte: new Date('2024-01-01'),
      lte: new Date('2024-12-31'),
    })
  })

  it('should not include createdAt filter when neither from nor to is provided', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await GET(makeRequest())

    const whereArg = mockDbAuditLogCount.mock.calls[0][0].where
    expect(whereArg).not.toHaveProperty('createdAt')
  })

  // ── Ordering ─────────────────────────────────────────────────────────────────

  it('should order results by createdAt descending', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await GET(makeRequest())

    expect(mockDbAuditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    )
  })

  // ── Combined filters ─────────────────────────────────────────────────────────

  it('should apply multiple filters simultaneously', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await GET(makeRequest('entityType=Employee&action=UPDATE&actorId=user-1&page=2'))

    const whereArg = mockDbAuditLogFindMany.mock.calls[0][0].where
    expect(whereArg.entityType).toEqual({ in: ['Employee'] })
    expect(whereArg.action).toEqual({ in: ['UPDATE'] })
    expect(whereArg.actorId).toBe('user-1')

    const skipArg = mockDbAuditLogFindMany.mock.calls[0][0].skip
    expect(skipArg).toBe(25)
  })
})
