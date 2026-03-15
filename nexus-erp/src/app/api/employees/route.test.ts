import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockDbUserFindUnique, mockDbUserCreate } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDbUserFindUnique: vi.fn(),
  mockDbUserCreate: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/db/client', () => ({
  db: {
    user: {
      findUnique: mockDbUserFindUnique,
      create: mockDbUserCreate,
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  },
}))
vi.mock('bcryptjs', () => ({ hash: vi.fn().mockResolvedValue('hashed-pw') }))

vi.mock('next/server', () => {
  class MockNextRequest {
    private _body: unknown
    constructor(_url: string, init?: { method?: string; body?: string }) {
      this._body = init?.body ? JSON.parse(init.body) : {}
    }
    async json() {
      return this._body
    }
  }
  const NextResponse = {
    json: (data: unknown, init?: { status?: number }) => ({
      _data: data,
      _status: init?.status ?? 200,
    }),
  }
  return { NextRequest: MockNextRequest, NextResponse }
})

import { NextRequest } from 'next/server'
import { POST } from './route'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/employees', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const DEFAULT_CREATE_RESULT = {
  id: 'user-1',
  email: 'test@example.com',
  role: 'employee',
  employee: {
    id: 'emp-1',
    fullName: 'Test User',
    hireDate: new Date('2024-01-01'),
  },
}

const VALID_BODY = {
  email: 'test@example.com',
  password: 'securepass',
  fullName: 'Test User',
  hireDate: '2024-01-01',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/employees', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbUserFindUnique.mockResolvedValue(null)
    mockDbUserCreate.mockResolvedValue(DEFAULT_CREATE_RESULT)
  })

  // ── Auth guards ─────────────────────────────────────────────────────────────

  it('should return 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest(VALID_BODY))
    expect(res._status).toBe(401)
    expect((res._data as any).error).toBe('Unauthorized')
  })

  it('should return 403 when session role is employee', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'employee' } })
    const res = await POST(makeRequest(VALID_BODY))
    expect(res._status).toBe(403)
    expect((res._data as any).error).toBe('Forbidden')
  })

  // ── Validation ──────────────────────────────────────────────────────────────

  it('should return 400 when required field email is missing', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const { email: _omit, ...bodyWithoutEmail } = VALID_BODY
    const res = await POST(makeRequest(bodyWithoutEmail))
    expect(res._status).toBe(400)
  })

  it('should return 400 when password is shorter than 8 characters', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await POST(makeRequest({ ...VALID_BODY, password: 'short' }))
    expect(res._status).toBe(400)
  })

  it('should return 400 when hireDate format is not YYYY-MM-DD', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await POST(makeRequest({ ...VALID_BODY, hireDate: '01/01/2024' }))
    expect(res._status).toBe(400)
  })

  // ── Conflict ────────────────────────────────────────────────────────────────

  it('should return 409 when email is already registered', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    mockDbUserFindUnique.mockResolvedValue({ id: 'existing-user' })
    const res = await POST(makeRequest(VALID_BODY))
    expect(res._status).toBe(409)
    expect((res._data as any).error).toBe('Email already registered')
  })

  // ── Success ─────────────────────────────────────────────────────────────────

  it('should return 201 on success with minimal required fields', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await POST(makeRequest(VALID_BODY))
    expect(res._status).toBe(201)
  })

  it('should return 201 and include employee.id in the response body', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    const res = await POST(makeRequest(VALID_BODY))
    expect(res._status).toBe(201)
    expect((res._data as any).employee.id).toBe('emp-1')
  })

  // ── db.user.create call shape ────────────────────────────────────────────────

  it('should call db.user.create with role defaulting to employee when role is not provided', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await POST(makeRequest(VALID_BODY))
    expect(mockDbUserCreate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'employee' }),
      }),
    )
  })

  it('should call db.user.create with role manager when role=manager is provided', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    mockDbUserCreate.mockResolvedValue({ ...DEFAULT_CREATE_RESULT, role: 'manager' })
    await POST(makeRequest({ ...VALID_BODY, role: 'manager' }))
    expect(mockDbUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'manager' }),
      }),
    )
  })

  it('should include managerId in employee.create when managerId is provided', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await POST(makeRequest({ ...VALID_BODY, managerId: 'mgr-42' }))
    expect(mockDbUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          employee: expect.objectContaining({
            create: expect.objectContaining({ managerId: 'mgr-42' }),
          }),
        }),
      }),
    )
  })

  it('should not include managerId in employee.create when managerId is not provided', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'manager' } })
    await POST(makeRequest(VALID_BODY))
    const createCall = mockDbUserCreate.mock.calls[0][0]
    expect(createCall.data.employee.create).not.toHaveProperty('managerId')
  })
})
