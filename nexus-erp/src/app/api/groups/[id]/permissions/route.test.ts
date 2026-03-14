import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockTx = {
  groupPermission: { deleteMany: vi.fn(), createMany: vi.fn() },
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
  return new NextRequest('http://localhost/api/groups/grp-1/permissions', { body: JSON.stringify(body) })
}

describe('PUT /api/groups/[id]/permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTx.groupPermission.deleteMany.mockResolvedValue({ count: 0 })
    mockTx.groupPermission.createMany.mockResolvedValue({ count: 0 })
    mockDbTransaction.mockImplementation(async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx))
  })

  it('should return 403 when no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PUT(makeRequest({ permissionKeys: [] }), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 403 when role is employee', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'employee' } })
    const res = await PUT(makeRequest({ permissionKeys: [] }), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should replace permissions with empty array', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await PUT(makeRequest({ permissionKeys: [] }), PARAMS)
    expect(res._status).toBe(200)
    expect((res._data as any).ok).toBe(true)
    expect(mockTx.groupPermission.deleteMany).toHaveBeenCalledWith({ where: { groupId: 'grp-1' } })
    expect(mockTx.groupPermission.createMany).not.toHaveBeenCalled()
  })

  it('should replace permissions with provided keys', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await PUT(makeRequest({ permissionKeys: ['read', 'write'] }), PARAMS)
    expect(res._status).toBe(200)
    expect(mockTx.groupPermission.createMany).toHaveBeenCalledWith({
      data: [
        { groupId: 'grp-1', permissionKey: 'read' },
        { groupId: 'grp-1', permissionKey: 'write' },
      ],
    })
  })
})
