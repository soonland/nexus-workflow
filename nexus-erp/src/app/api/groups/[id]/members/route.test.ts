import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockTx = {
  groupMembership: { deleteMany: vi.fn(), createMany: vi.fn() },
}

const { mockAuth, mockDbTransaction } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDbTransaction: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/db/client', () => ({ db: { $transaction: mockDbTransaction } }))
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
import { PUT } from './route'

const PARAMS = { params: Promise.resolve({ id: 'grp-1' }) }

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/groups/grp-1/members', { body: JSON.stringify(body) })
}

describe('PUT /api/groups/[id]/members', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTx.groupMembership.deleteMany.mockResolvedValue({ count: 0 })
    mockTx.groupMembership.createMany.mockResolvedValue({ count: 0 })
    mockDbTransaction.mockImplementation(async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx))
  })

  it('should return 403 when no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PUT(makeRequest({ userIds: [] }), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 403 when role is employee', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'employee' } })
    const res = await PUT(makeRequest({ userIds: [] }), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should replace members with empty array', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await PUT(makeRequest({ userIds: [] }), PARAMS)
    expect(res._status).toBe(200)
    expect((res._data as any).ok).toBe(true)
    expect(mockTx.groupMembership.deleteMany).toHaveBeenCalledWith({ where: { groupId: 'grp-1' } })
    expect(mockTx.groupMembership.createMany).not.toHaveBeenCalled()
  })

  it('should replace members with provided userIds', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await PUT(makeRequest({ userIds: ['user-1', 'user-2'] }), PARAMS)
    expect(res._status).toBe(200)
    expect(mockTx.groupMembership.createMany).toHaveBeenCalledWith({
      data: [
        { groupId: 'grp-1', userId: 'user-1' },
        { groupId: 'grp-1', userId: 'user-2' },
      ],
    })
  })
})
