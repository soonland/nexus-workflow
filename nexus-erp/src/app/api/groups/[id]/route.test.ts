import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockDbGroupFindUnique, mockDbGroupUpdate, mockDbGroupDelete } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDbGroupFindUnique: vi.fn(),
  mockDbGroupUpdate: vi.fn(),
  mockDbGroupDelete: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/db/client', () => ({
  db: {
    group: {
      findUnique: mockDbGroupFindUnique,
      update: mockDbGroupUpdate,
      delete: mockDbGroupDelete,
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
import { GET, PATCH, DELETE } from './route'

const PARAMS = { params: Promise.resolve({ id: 'grp-1' }) }
const GROUP = { id: 'grp-1', name: 'Admins', type: 'security', permissions: [], members: [] }

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/groups/grp-1', { body: JSON.stringify(body) })
}

describe('GET /api/groups/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbGroupFindUnique.mockResolvedValue(GROUP)
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

  it('should return 404 when group not found', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    mockDbGroupFindUnique.mockResolvedValue(null)
    const res = await GET(makeRequest({}), PARAMS)
    expect(res._status).toBe(404)
  })

  it('should return group on success', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await GET(makeRequest({}), PARAMS)
    expect(res._status).toBe(200)
    expect((res._data as any).id).toBe('grp-1')
  })
})

describe('PATCH /api/groups/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbGroupUpdate.mockResolvedValue({ ...GROUP, name: 'Updated' })
  })

  it('should return 403 when role is employee', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'employee' } })
    const res = await PATCH(makeRequest({ name: 'Updated' }), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return updated group on success', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await PATCH(makeRequest({ name: 'Updated' }), PARAMS)
    expect(res._status).toBe(200)
    expect((res._data as any).name).toBe('Updated')
  })
})

describe('DELETE /api/groups/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbGroupDelete.mockResolvedValue(GROUP)
  })

  it('should return 403 when role is employee', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'employee' } })
    const res = await DELETE(makeRequest({}), PARAMS)
    expect(res._status).toBe(403)
  })

  it('should return 204 on successful delete', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await DELETE(makeRequest({}), PARAMS)
    expect(res._status).toBe(204)
    expect(mockDbGroupDelete).toHaveBeenCalledWith({ where: { id: 'grp-1' } })
  })
})
