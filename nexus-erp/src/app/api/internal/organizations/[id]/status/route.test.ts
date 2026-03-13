import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDbOrgFindUnique, mockDbOrgUpdate } = vi.hoisted(() => {
  process.env.INTERNAL_API_KEY = 'secret-key'
  return { mockDbOrgFindUnique: vi.fn(), mockDbOrgUpdate: vi.fn() }
})

vi.mock('@/db/client', () => ({
  db: {
    organization: {
      findUnique: mockDbOrgFindUnique,
      update: mockDbOrgUpdate,
    },
  },
}))

vi.mock('next/server', () => {
  class MockNextRequest {
    private _body: unknown
    private _headers: Map<string, string>
    constructor(_url: string, init?: { body?: string; headers?: Record<string, string> }) {
      this._body = init?.body ? JSON.parse(init.body) : {}
      this._headers = new Map(Object.entries(init?.headers ?? {}))
    }
    async json() { return this._body }
    get headers() {
      return { get: (k: string) => this._headers.get(k) ?? null }
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

const PARAMS = { params: Promise.resolve({ id: 'org-1' }) }

function makeRequest(body: unknown, token?: string) {
  return new NextRequest('http://localhost/api/internal/organizations/org-1/status', {
    body: JSON.stringify(body),
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

describe('PATCH /api/internal/organizations/[id]/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbOrgFindUnique.mockResolvedValue({ id: 'org-1' })
    mockDbOrgUpdate.mockResolvedValue({ id: 'org-1', status: 'active' })
  })

  it('should return 401 when no authorization header', async () => {
    const res = await PATCH(makeRequest({ status: 'active' }), PARAMS)
    expect(res._status).toBe(401)
  })

  it('should return 401 when token is wrong', async () => {
    const res = await PATCH(makeRequest({ status: 'active' }, 'bad'), PARAMS)
    expect(res._status).toBe(401)
  })

  it('should return 400 when status is invalid', async () => {
    const res = await PATCH(makeRequest({ status: 'invalid-value' }, 'secret-key'), PARAMS)
    expect(res._status).toBe(400)
  })

  it('should return 404 when organization not found', async () => {
    mockDbOrgFindUnique.mockResolvedValue(null)
    const res = await PATCH(makeRequest({ status: 'active' }, 'secret-key'), PARAMS)
    expect(res._status).toBe(404)
  })

  it('should update status and return organization', async () => {
    const res = await PATCH(makeRequest({ status: 'inactive' }, 'secret-key'), PARAMS)
    expect(res._status).toBe(200)
    expect(mockDbOrgUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'org-1' } }),
    )
  })

  it('should accept workflowInstanceId and statusChangeReason fields', async () => {
    const res = await PATCH(
      makeRequest({ workflowInstanceId: 'wf-1', statusChangeReason: 'reason' }, 'secret-key'),
      PARAMS,
    )
    expect(res._status).toBe(200)
  })
})
