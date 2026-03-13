import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockAuth,
  mockDbUserFindUnique,
  mockDbGroupDeleteMany,
  mockDbGroupCreateMany,
  mockDbTransaction,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDbUserFindUnique: vi.fn(),
  mockDbGroupDeleteMany: vi.fn(),
  mockDbGroupCreateMany: vi.fn(),
  mockDbTransaction: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/db/client', () => ({
  db: {
    user: {
      findUnique: mockDbUserFindUnique,
    },
    groupMembership: {
      deleteMany: mockDbGroupDeleteMany,
      createMany: mockDbGroupCreateMany,
    },
    $transaction: mockDbTransaction,
  },
}))
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

const PARAMS = { params: Promise.resolve({ id: 'user-1' }) }

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/users/user-1/groups', {
    body: JSON.stringify(body),
  })
}

describe('PUT /api/users/[id]/groups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbTransaction.mockResolvedValue([])
    mockDbGroupDeleteMany.mockResolvedValue({ count: 0 })
    mockDbGroupCreateMany.mockResolvedValue({ count: 0 })
  })

  it('should return 403 when no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PUT(makeRequest({ groupIds: [] }), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 404 when target user not found', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager', id: 'user-mgr' } })
    mockDbUserFindUnique.mockResolvedValue(null)
    const res = await PUT(makeRequest({ groupIds: [] }), PARAMS)
    expect(res._status).toBe(404)
  })

  it('should return 200 with empty groupIds and call deleteMany but not createMany', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager', id: 'user-mgr' } })
    mockDbUserFindUnique.mockResolvedValue({ id: 'user-1' })

    const res = await PUT(makeRequest({ groupIds: [] }), PARAMS)

    expect(res._status).toBe(200)
    expect((res._data as any).groupIds).toEqual([])
    expect(mockDbGroupDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(mockDbGroupCreateMany).not.toHaveBeenCalled()
    expect(mockDbTransaction).toHaveBeenCalled()
  })

  it('should return 200 and call both deleteMany and createMany with correct args', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager', id: 'user-mgr' } })
    mockDbUserFindUnique.mockResolvedValue({ id: 'user-1' })

    const res = await PUT(makeRequest({ groupIds: ['grp-1', 'grp-2'] }), PARAMS)

    expect(res._status).toBe(200)
    expect((res._data as any).groupIds).toEqual(['grp-1', 'grp-2'])
    expect(mockDbGroupDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(mockDbGroupCreateMany).toHaveBeenCalledWith({
      data: [
        { userId: 'user-1', groupId: 'grp-1' },
        { userId: 'user-1', groupId: 'grp-2' },
      ],
    })
    expect(mockDbTransaction).toHaveBeenCalled()
  })
})
