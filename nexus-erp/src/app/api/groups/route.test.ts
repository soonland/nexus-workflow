import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockTx = {
  group: { create: vi.fn() },
  groupPermission: { createMany: vi.fn() },
  groupMembership: { createMany: vi.fn() },
}

const { mockAuth, mockDbGroupFindMany, mockDbTransaction } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDbGroupFindMany: vi.fn(),
  mockDbTransaction: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/db/client', () => ({
  db: {
    group: { findMany: mockDbGroupFindMany },
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
import { GET, POST } from './route'

const GROUP = { id: 'grp-1', name: 'Admins', type: 'security', _count: { permissions: 0, members: 0 } }

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/groups', { body: JSON.stringify(body) })
}

describe('GET /api/groups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbGroupFindMany.mockResolvedValue([GROUP])
  })

  it('should return 403 when no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET()
    expect(res._status).toBe(403)
  })

  it('should return 403 when role is employee', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'employee' } })
    const res = await GET()
    expect(res._status).toBe(403)
  })

  it('should return groups list', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await GET()
    expect(res._status).toBe(200)
    expect(res._data).toHaveLength(1)
  })
})

describe('POST /api/groups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTx.group.create.mockResolvedValue(GROUP)
    mockTx.groupPermission.createMany.mockResolvedValue({ count: 0 })
    mockTx.groupMembership.createMany.mockResolvedValue({ count: 0 })
    mockDbTransaction.mockImplementation(async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx))
  })

  it('should return 403 when no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest({ name: 'HR' }))
    expect(res._status).toBe(403)
  })

  it('should return 400 when name is missing', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await POST(makeRequest({}))
    expect(res._status).toBe(400)
    expect((res._data as any).error).toBe('Name is required')
  })

  it('should return 400 when name is blank', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await POST(makeRequest({ name: '   ' }))
    expect(res._status).toBe(400)
  })

  it('should return 201 on success', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await POST(makeRequest({ name: 'Admins' }))
    expect(res._status).toBe(201)
    expect((res._data as any).id).toBe('grp-1')
  })

  it('should call groupPermission.createMany when permissionKeys are provided', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await POST(makeRequest({ name: 'Admins', permissionKeys: ['read', 'write'] }))
    expect(mockTx.groupPermission.createMany).toHaveBeenCalledOnce()
  })

  it('should call groupMembership.createMany when memberUserIds are provided', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await POST(makeRequest({ name: 'Admins', memberUserIds: ['user-1'] }))
    expect(mockTx.groupMembership.createMany).toHaveBeenCalledOnce()
  })
})
