import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockDeleteDefinition } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDeleteDefinition: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/workflow', () => ({ deleteDefinition: mockDeleteDefinition }))
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

import { DELETE } from './route'

const PARAMS = { params: Promise.resolve({ id: 'def-1' }) }

describe('DELETE /api/workflow/definitions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteDefinition.mockResolvedValue({ ok: true })
  })

  it('should return 403 when no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await DELETE({} as Request, PARAMS)
    expect(res._status).toBe(403)
    expect((res._data as any).error).toBe('Forbidden')
  })

  it('should return 403 when role is employee', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'employee' } })
    const res = await DELETE({} as Request, PARAMS)
    expect(res._status).toBe(403)
  })

  it('should call deleteDefinition and return result on success', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await DELETE({} as Request, PARAMS)
    expect(mockDeleteDefinition).toHaveBeenCalledWith('def-1')
    expect(res._status).toBe(200)
  })

  it('should return 404 when error message includes "404"', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    mockDeleteDefinition.mockRejectedValue(new Error('404 Not Found'))
    const res = await DELETE({} as Request, PARAMS)
    expect(res._status).toBe(404)
    expect((res._data as any).error).toBe('NOT_FOUND')
  })

  it('should return 409 when error message includes "409"', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    mockDeleteDefinition.mockRejectedValue(new Error('409 Conflict'))
    const res = await DELETE({} as Request, PARAMS)
    expect(res._status).toBe(409)
    expect((res._data as any).error).toBe('HAS_ACTIVE_INSTANCES')
  })

  it('should return 500 on generic error', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    mockDeleteDefinition.mockRejectedValue(new Error('Something went wrong'))
    const res = await DELETE({} as Request, PARAMS)
    expect(res._status).toBe(500)
  })
})
