import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockCanEditContact, mockDbFindUnique, mockDbUpdate, mockDbAuditLogCreate } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCanEditContact: vi.fn(),
  mockDbFindUnique: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbAuditLogCreate: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/orgAccess', () => ({ canEditContact: mockCanEditContact }))
vi.mock('@/db/client', () => ({
  db: {
    organization: {
      findUnique: mockDbFindUnique,
      update: mockDbUpdate,
    },
    auditLog: { create: mockDbAuditLogCreate },
  },
}))
vi.mock('next/server', () => {
  class MockNextRequest {
    private _body: unknown
    url: string
    nextUrl: URL
    constructor(url: string, init?: { body?: string }) {
      this._body = init?.body ? JSON.parse(init.body) : {}
      this.url = url
      this.nextUrl = new URL(url)
    }
    async json() {
      return this._body
    }
  }
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
  return { NextRequest: MockNextRequest, NextResponse: MockNextResponse }
})

import { NextRequest } from 'next/server'
import { PATCH } from './route'

const params = Promise.resolve({ id: 'org-1' })

describe('PATCH /api/organizations/[id]/contact', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('should return 401 when no session', async () => {
    mockAuth.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/organizations/org-1/contact', {
      body: JSON.stringify({ email: 'test@example.com' }),
    })
    const res = await PATCH(req, { params })

    expect(res._status).toBe(401)
    expect(res._data).toEqual({ error: 'Unauthorized' })
  })

  it('should return 404 when organization not found', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: 'emp-1' } })
    mockDbFindUnique.mockResolvedValue(null)

    const req = new NextRequest('http://localhost/api/organizations/org-1/contact', {
      body: JSON.stringify({ email: 'test@example.com' }),
    })
    const res = await PATCH(req, { params })

    expect(res._status).toBe(404)
    expect(res._data).toEqual({ error: 'Not found' })
  })

  it('should return 403 when canEditContact returns false', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'employee', employeeId: 'emp-1' } })
    mockDbFindUnique.mockResolvedValue({ ownerId: 'emp-2' })
    mockCanEditContact.mockReturnValue(false)

    const req = new NextRequest('http://localhost/api/organizations/org-1/contact', {
      body: JSON.stringify({ email: 'test@example.com' }),
    })
    const res = await PATCH(req, { params })

    expect(res._status).toBe(403)
    expect(res._data).toEqual({ error: 'Forbidden' })
  })

  it('should return 200 on success', async () => {
    const session = { user: { id: 'user-1', role: 'manager', employeeId: 'emp-1' } }
    mockAuth.mockResolvedValue(session)
    mockDbFindUnique.mockResolvedValue({ ownerId: 'emp-1' })
    mockCanEditContact.mockReturnValue(true)
    const updated = { id: 'org-1', email: 'test@example.com', owner: null }
    mockDbUpdate.mockResolvedValue(updated)

    const req = new NextRequest('http://localhost/api/organizations/org-1/contact', {
      body: JSON.stringify({ email: 'test@example.com', phone: '555-1234' }),
    })
    const res = await PATCH(req, { params })

    expect(res._status).toBe(200)
    expect(res._data).toEqual(updated)
    expect(mockDbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'org-1' },
        data: expect.objectContaining({ email: 'test@example.com' }),
      }),
    )
  })
})
