import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockDbDeptFindMany, mockDbDeptCreate, mockDbEmpUpdateMany } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDbDeptFindMany: vi.fn(),
  mockDbDeptCreate: vi.fn(),
  mockDbEmpUpdateMany: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/db/client', () => ({
  db: {
    department: { findMany: mockDbDeptFindMany, create: mockDbDeptCreate },
    employee: { updateMany: mockDbEmpUpdateMany },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
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

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/departments', { body: JSON.stringify(body) })
}

const DEPT = { id: 'dept-1', name: 'Engineering', _count: { employees: 2 } }

describe('GET /api/departments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbDeptFindMany.mockResolvedValue([DEPT])
  })

  it('should return 401 when no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET()
    expect(res._status).toBe(401)
  })

  it('should return departments list', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await GET()
    expect(res._status).toBe(200)
    expect(res._data).toHaveLength(1)
  })
})

describe('POST /api/departments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbDeptCreate.mockResolvedValue(DEPT)
    mockDbEmpUpdateMany.mockResolvedValue({ count: 0 })
  })

  it('should return 403 when no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest({ name: 'HR' }))
    expect(res._status).toBe(403)
  })

  it('should return 403 when role is employee', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'employee' } })
    const res = await POST(makeRequest({ name: 'HR' }))
    expect(res._status).toBe(403)
  })

  it('should return 400 when name is missing', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await POST(makeRequest({}))
    expect(res._status).toBe(400)
  })

  it('should return 400 when name exceeds 100 characters', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await POST(makeRequest({ name: 'x'.repeat(101) }))
    expect(res._status).toBe(400)
  })

  it('should return 409 when db throws (duplicate name)', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    mockDbDeptCreate.mockRejectedValue(new Error('unique constraint'))
    const res = await POST(makeRequest({ name: 'Engineering' }))
    expect(res._status).toBe(409)
    expect((res._data as any).error).toBe('A department with that name already exists')
  })

  it('should return 201 on success', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await POST(makeRequest({ name: 'HR' }))
    expect(res._status).toBe(201)
    expect((res._data as any).id).toBe('dept-1')
  })

  it('should call employee.updateMany when memberIds are provided', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await POST(makeRequest({ name: 'HR', memberIds: ['emp-1', 'emp-2'] }))
    expect(mockDbEmpUpdateMany).toHaveBeenCalledOnce()
  })

  it('should not call employee.updateMany when memberIds is empty', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await POST(makeRequest({ name: 'HR' }))
    expect(mockDbEmpUpdateMany).not.toHaveBeenCalled()
  })
})
