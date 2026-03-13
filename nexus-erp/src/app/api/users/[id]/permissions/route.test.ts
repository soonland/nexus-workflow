import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockAuth,
  mockDbPermFindMany,
  mockDbPermDeleteMany,
  mockDbPermCreateMany,
  mockDbUserFindUnique,
  mockDbTransaction,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDbPermFindMany: vi.fn(),
  mockDbPermDeleteMany: vi.fn(),
  mockDbPermCreateMany: vi.fn(),
  mockDbUserFindUnique: vi.fn(),
  mockDbTransaction: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/db/client', () => ({
  db: {
    userPermission: {
      findMany: mockDbPermFindMany,
      deleteMany: mockDbPermDeleteMany,
      createMany: mockDbPermCreateMany,
    },
    user: {
      findUnique: mockDbUserFindUnique,
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
import { GET, PUT } from './route'

const PARAMS = { params: Promise.resolve({ id: 'user-1' }) }

function makeGetRequest() {
  return new NextRequest('http://localhost/api/users/user-1/permissions')
}

function makePutRequest(body: unknown) {
  return new NextRequest('http://localhost/api/users/user-1/permissions', {
    body: JSON.stringify(body),
  })
}

describe('GET /api/users/[id]/permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbTransaction.mockResolvedValue([])
    mockDbPermDeleteMany.mockResolvedValue({ count: 0 })
    mockDbPermCreateMany.mockResolvedValue({ count: 0 })
  })

  it('should return 403 when no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGetRequest(), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 200 with permissions list', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager', id: 'user-mgr' } })
    const permissionsList = [
      { permissionKey: 'employees:read', permission: { key: 'employees:read', label: 'Read Employees' } },
    ]
    mockDbPermFindMany.mockResolvedValue(permissionsList)

    const res = await GET(makeGetRequest(), PARAMS)

    expect(res._status).toBe(200)
    expect((res._data as any).permissions).toEqual(permissionsList)
    expect(mockDbPermFindMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      include: { permission: true },
    })
  })
})

describe('PUT /api/users/[id]/permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbTransaction.mockResolvedValue([])
    mockDbPermDeleteMany.mockResolvedValue({ count: 0 })
    mockDbPermCreateMany.mockResolvedValue({ count: 0 })
  })

  it('should return 403 when role is employee', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'employee', id: 'user-1' } })
    const res = await PUT(makePutRequest({ permissionKeys: [] }), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 404 when target user not found', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager', id: 'user-mgr' } })
    mockDbUserFindUnique.mockResolvedValue(null)
    const res = await PUT(makePutRequest({ permissionKeys: [] }), PARAMS)
    expect(res._status).toBe(404)
  })

  it('should return 200 with empty permissionKeys and call deleteMany but not createMany', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager', id: 'user-mgr' } })
    mockDbUserFindUnique.mockResolvedValue({ id: 'user-1' })

    const res = await PUT(makePutRequest({ permissionKeys: [] }), PARAMS)

    expect(res._status).toBe(200)
    expect((res._data as any).permissionKeys).toEqual([])
    expect(mockDbPermDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(mockDbPermCreateMany).not.toHaveBeenCalled()
    expect(mockDbTransaction).toHaveBeenCalled()
  })

  it('should return 200 and call both deleteMany and createMany with correct args', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager', id: 'user-mgr' } })
    mockDbUserFindUnique.mockResolvedValue({ id: 'user-1' })

    const res = await PUT(makePutRequest({ permissionKeys: ['employees:read', 'employees:write'] }), PARAMS)

    expect(res._status).toBe(200)
    expect((res._data as any).permissionKeys).toEqual(['employees:read', 'employees:write'])
    expect(mockDbPermDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(mockDbPermCreateMany).toHaveBeenCalledWith({
      data: [
        { userId: 'user-1', permissionKey: 'employees:read', grantedById: 'user-mgr' },
        { userId: 'user-1', permissionKey: 'employees:write', grantedById: 'user-mgr' },
      ],
    })
    expect(mockDbTransaction).toHaveBeenCalled()
  })
})
