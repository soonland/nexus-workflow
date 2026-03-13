import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockSuspendInstance } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockSuspendInstance: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/workflow', () => ({ suspendInstance: mockSuspendInstance }))
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

import { POST } from './route'

const PARAMS = { params: Promise.resolve({ id: 'instance-1' }) }

describe('POST /api/workflow/instances/[id]/suspend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSuspendInstance.mockResolvedValue({ id: 'instance-1', status: 'suspended' })
  })

  it('should return 403 when no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST({} as Request, PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 403 when role is employee', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'employee' } })
    const res = await POST({} as Request, PARAMS)
    expect(res._status).toBe(403)
  })

  it('should call suspendInstance and return result on success', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await POST({} as Request, PARAMS)
    expect(mockSuspendInstance).toHaveBeenCalledWith('instance-1')
    expect(res._status).toBe(200)
  })
})
