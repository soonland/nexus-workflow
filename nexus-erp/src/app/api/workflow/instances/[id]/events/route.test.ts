import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockGetInstanceEvents } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockGetInstanceEvents: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/workflow', () => ({ getInstanceEvents: mockGetInstanceEvents }))
vi.mock('next/server', () => {
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
  return { NextResponse: MockNextResponse }
})

import { GET } from './route'

const PARAMS = { params: Promise.resolve({ id: 'instance-1' }) }

describe('GET /api/workflow/instances/[id]/events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetInstanceEvents.mockResolvedValue([{ type: 'started', at: '2024-01-01' }])
  })

  it('should return 403 when no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET({} as Request, PARAMS)
    expect(res._status).toBe(403)
    expect((res._data as any).error).toBe('Forbidden')
  })

  it('should return 403 when role is employee', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'employee' } })
    const res = await GET({} as Request, PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return events on success', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await GET({} as Request, PARAMS)
    expect(mockGetInstanceEvents).toHaveBeenCalledWith('instance-1')
    expect(res._status).toBe(200)
    expect((res._data as any).events).toHaveLength(1)
  })

  it('should return 404 when error message includes "404"', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    mockGetInstanceEvents.mockRejectedValue(new Error('404 Not Found'))
    const res = await GET({} as Request, PARAMS)
    expect(res._status).toBe(404)
    expect((res._data as any).error).toBe('NOT_FOUND')
  })

  it('should return 500 on generic error', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    mockGetInstanceEvents.mockRejectedValue(new Error('Internal error'))
    const res = await GET({} as Request, PARAMS)
    expect(res._status).toBe(500)
  })
})
