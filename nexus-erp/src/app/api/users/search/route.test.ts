import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockDbUserFindMany } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDbUserFindMany: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/db/client', () => ({
  db: {
    user: {
      findMany: mockDbUserFindMany,
    },
  },
}))

vi.mock('next/server', () => {
  const NextResponse = {
    json: (data: unknown, init?: { status?: number }) => ({
      _data: data,
      _status: init?.status ?? 200,
    }),
  }
  return { NextResponse }
})

import { GET } from './route'

// ── Helpers ────────────────────────────────────────────────────────────────────

const SESSION_USER = { id: 'user-1', role: 'employee' }

function makeRequest(q?: string) {
  const url = q !== undefined
    ? `http://localhost/api/users/search?q=${encodeURIComponent(q)}`
    : 'http://localhost/api/users/search'
  return new Request(url)
}

function makeUser(overrides: Partial<{
  id: string
  email: string
  fullName: string | null
}> = {}) {
  return {
    id: overrides.id ?? 'user-2',
    email: overrides.email ?? 'alice@example.com',
    employee: overrides.fullName !== undefined
      ? (overrides.fullName ? { fullName: overrides.fullName } : null)
      : { fullName: 'Alice Smith' },
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GET /api/users/search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: SESSION_USER })
    mockDbUserFindMany.mockResolvedValue([makeUser()])
  })

  // ── Auth guards ──────────────────────────────────────────────────────────────

  it('should return 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest('alice'))
    expect((res as any)._status).toBe(401)
    expect((res as any)._data.error).toBe('Unauthorized')
  })

  // ── Empty / missing query ────────────────────────────────────────────────────

  it('should return an empty array when the q param is absent', async () => {
    const res = await GET(makeRequest())
    expect((res as any)._status).toBe(200)
    expect((res as any)._data).toEqual([])
    expect(mockDbUserFindMany).not.toHaveBeenCalled()
  })

  it('should return an empty array when q is an empty string', async () => {
    const res = await GET(makeRequest(''))
    expect((res as any)._status).toBe(200)
    expect((res as any)._data).toEqual([])
    expect(mockDbUserFindMany).not.toHaveBeenCalled()
  })

  it('should return an empty array when q is whitespace only', async () => {
    const res = await GET(makeRequest('   '))
    expect((res as any)._status).toBe(200)
    expect((res as any)._data).toEqual([])
    expect(mockDbUserFindMany).not.toHaveBeenCalled()
  })

  // ── Success ──────────────────────────────────────────────────────────────────

  it('should return 200 with matching users on success', async () => {
    const res = await GET(makeRequest('alice'))
    expect((res as any)._status).toBe(200)
    expect(Array.isArray((res as any)._data)).toBe(true)
    expect((res as any)._data).toHaveLength(1)
  })

  it('should map employee.fullName as the name field', async () => {
    const res = await GET(makeRequest('alice'))
    const [user] = (res as any)._data
    expect(user.name).toBe('Alice Smith')
    expect(user.email).toBe('alice@example.com')
    expect(user.id).toBe('user-2')
  })

  it('should fall back to email when employee record is absent', async () => {
    mockDbUserFindMany.mockResolvedValue([makeUser({ fullName: null })])
    const res = await GET(makeRequest('alice'))
    const [user] = (res as any)._data
    expect(user.name).toBe('alice@example.com')
  })

  it('should return an empty array when no users match the query', async () => {
    mockDbUserFindMany.mockResolvedValue([])
    const res = await GET(makeRequest('zzznomatch'))
    expect((res as any)._data).toEqual([])
  })

  // ── DB query shape ────────────────────────────────────────────────────────────

  it('should exclude the current user from results', async () => {
    await GET(makeRequest('alice'))
    expect(mockDbUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { not: SESSION_USER.id } }),
      }),
    )
  })

  it('should search both by email and employee.fullName', async () => {
    await GET(makeRequest('alice'))
    expect(mockDbUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ email: expect.objectContaining({ contains: 'alice' }) }),
            expect.objectContaining({ employee: expect.objectContaining({ fullName: expect.objectContaining({ contains: 'alice' }) }) }),
          ]),
        }),
      }),
    )
  })

  it('should limit results to 10', async () => {
    await GET(makeRequest('a'))
    expect(mockDbUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 }),
    )
  })

  it('should trim the search query before passing it to the database', async () => {
    await GET(makeRequest('  alice  '))
    expect(mockDbUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ email: expect.objectContaining({ contains: 'alice' }) }),
          ]),
        }),
      }),
    )
  })
})
