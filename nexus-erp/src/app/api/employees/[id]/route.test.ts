import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockAuth,
  mockCanAccess,
  mockDbEmpFindUnique,
  mockDbEmpUpdate,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCanAccess: vi.fn(),
  mockDbEmpFindUnique: vi.fn(),
  mockDbEmpUpdate: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/access', () => ({ canAccess: mockCanAccess }))
vi.mock('@/db/client', () => ({
  db: {
    employee: {
      findUnique: mockDbEmpFindUnique,
      update: mockDbEmpUpdate,
    },
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
import { GET, PATCH } from './route'

const PARAMS = { params: Promise.resolve({ id: 'emp-1' }) }

const EMP = {
  id: 'emp-1', fullName: 'Alice Smith', hireDate: new Date('2020-01-01'),
  phone: null, street: null, city: null, state: null, postalCode: null, country: null,
  userId: 'user-1',
  department: { id: 'dept-1', name: 'Engineering' },
  manager: null,
  user: {
    email: 'alice@example.com', role: 'employee',
    permissions: [{ permission: { key: 'employees:read', label: 'Read Employees' } }],
    groups: [{ group: { id: 'grp-1', name: 'Admins', permissions: [{ permissionKey: 'employees:write' }] } }],
  },
}

function makeGetRequest() {
  return new NextRequest('http://localhost/api/employees/emp-1')
}

function makePatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/employees/emp-1', {
    body: JSON.stringify(body),
  })
}

describe('GET /api/employees/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 when no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGetRequest(), PARAMS)
    expect(res._status).toBe(401)
  })

  it('should return 404 when employee not found', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager', id: 'user-mgr' } })
    mockDbEmpFindUnique.mockResolvedValue(null)
    const res = await GET(makeGetRequest(), PARAMS)
    expect(res._status).toBe(404)
  })

  it('should return 403 when canAccess returns false', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager', id: 'user-mgr' } })
    mockDbEmpFindUnique.mockResolvedValue(EMP)
    mockCanAccess.mockResolvedValue(false)
    const res = await GET(makeGetRequest(), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 200 with effectivePermissions merging direct and group permissions', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager', id: 'user-mgr' } })
    mockDbEmpFindUnique.mockResolvedValue(EMP)
    mockCanAccess.mockResolvedValue(true)
    const res = await GET(makeGetRequest(), PARAMS)
    expect(res._status).toBe(200)
    const data = res._data as any
    expect(data.id).toBe('emp-1')
    expect(data.effectivePermissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'employees:read', direct: true, groups: [] }),
        expect.objectContaining({ key: 'employees:write', direct: false, groups: [{ id: 'grp-1', name: 'Admins' }] }),
      ])
    )
    expect(data.effectivePermissions).toHaveLength(2)
  })
})

describe('PATCH /api/employees/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 when no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makePatchRequest({ phone: '555-0100' }), PARAMS)
    expect(res._status).toBe(401)
  })

  it('should return 403 when not manager and not own profile', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'employee', employeeId: 'emp-other', id: 'user-other' } })
    const res = await PATCH(makePatchRequest({ phone: '555-0100' }), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 403 when employee tries to update a non-contact field', async () => {
    // Employee is updating their own profile but tries to change fullName
    mockAuth.mockResolvedValue({ user: { role: 'employee', employeeId: 'emp-1', id: 'user-1' } })
    const res = await PATCH(makePatchRequest({ fullName: 'Alice Jones' }), PARAMS)
    expect(res._status).toBe(403)
    expect((res._data as any).error).toMatch(/contact/i)
  })

  it('should return 200 when manager updates fullName', async () => {
    const updatedEmp = { ...EMP, fullName: 'Alice Jones' }
    mockAuth.mockResolvedValue({ user: { role: 'manager', employeeId: 'emp-mgr', id: 'user-mgr' } })
    mockDbEmpUpdate.mockResolvedValue(updatedEmp)
    const res = await PATCH(makePatchRequest({ fullName: 'Alice Jones' }), PARAMS)
    expect(res._status).toBe(200)
    expect(mockDbEmpUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'emp-1' },
        data: expect.objectContaining({ fullName: 'Alice Jones' }),
      })
    )
  })
})
