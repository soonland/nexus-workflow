import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockTx = {
  department: { update: vi.fn() },
  employee: { updateMany: vi.fn() },
}

const {
  mockAuth,
  mockDbDeptFindUnique,
  mockDbDeptDelete,
  mockDbEmpCount,
  mockDbTransaction,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDbDeptFindUnique: vi.fn(),
  mockDbDeptDelete: vi.fn(),
  mockDbEmpCount: vi.fn(),
  mockDbTransaction: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/db/client', () => ({
  db: {
    department: { findUnique: mockDbDeptFindUnique, delete: mockDbDeptDelete },
    employee: { count: mockDbEmpCount },
    $transaction: mockDbTransaction,
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
import { GET, PATCH, DELETE } from './route'

const PARAMS = { params: Promise.resolve({ id: 'dept-1' }) }
const DEPT = { id: 'dept-1', name: 'Engineering', employees: [], _count: { employees: 0 } }

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/departments/dept-1', { body: JSON.stringify(body) })
}

describe('GET /api/departments/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbDeptFindUnique.mockResolvedValue(DEPT)
  })

  it('should return 403 when no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest({}), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 403 when role is employee', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'employee' } })
    const res = await GET(makeRequest({}), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 404 when department not found', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    mockDbDeptFindUnique.mockResolvedValue(null)
    const res = await GET(makeRequest({}), PARAMS)
    expect(res._status).toBe(404)
  })

  it('should return department on success', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await GET(makeRequest({}), PARAMS)
    expect(res._status).toBe(200)
    expect((res._data as any).id).toBe('dept-1')
  })
})

describe('PATCH /api/departments/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTx.department.update.mockResolvedValue(DEPT)
    mockTx.employee.updateMany.mockResolvedValue({ count: 0 })
    mockDbTransaction.mockImplementation(async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx))
    mockDbDeptFindUnique.mockResolvedValue(DEPT)
  })

  it('should return 403 when role is employee', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'employee' } })
    const res = await PATCH(makeRequest({ name: 'New Name' }), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 409 when transaction throws', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    mockDbTransaction.mockRejectedValue(new Error('conflict'))
    const res = await PATCH(makeRequest({ name: 'Engineering' }), PARAMS)
    expect(res._status).toBe(409)
  })

  it('should return updated department on success', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await PATCH(makeRequest({ name: 'New Name' }), PARAMS)
    expect(res._status).toBe(200)
  })
})

describe('DELETE /api/departments/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbEmpCount.mockResolvedValue(0)
    mockDbDeptDelete.mockResolvedValue(DEPT)
  })

  it('should return 403 when role is employee', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'employee' } })
    const res = await DELETE(makeRequest({}), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 409 when employees are assigned', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    mockDbEmpCount.mockResolvedValue(3)
    const res = await DELETE(makeRequest({}), PARAMS)
    expect(res._status).toBe(409)
    expect((res._data as any).error).toMatch(/3 employee/)
  })

  it('should return 204 on successful delete', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await DELETE(makeRequest({}), PARAMS)
    expect(res._status).toBe(204)
    expect(mockDbDeptDelete).toHaveBeenCalledWith({ where: { id: 'dept-1' } })
  })
})
