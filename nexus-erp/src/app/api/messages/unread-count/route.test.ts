import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockDbQueryRaw } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDbQueryRaw: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/db/client', () => ({
  db: {
    $queryRaw: mockDbQueryRaw,
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

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GET /api/messages/unread-count', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: SESSION_USER })
    // Prisma returns bigint for COUNT(*)
    mockDbQueryRaw.mockResolvedValue([{ count: BigInt(3) }])
  })

  // ── Auth guards ──────────────────────────────────────────────────────────────

  it('should return 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET()
    expect((res as any)._status).toBe(401)
    expect((res as any)._data.error).toBe('Unauthorized')
  })

  // ── Success ──────────────────────────────────────────────────────────────────

  it('should return 200 with a count field on success', async () => {
    const res = await GET()
    expect((res as any)._status).toBe(200)
    expect((res as any)._data).toHaveProperty('count')
  })

  it('should convert the bigint count to a regular number', async () => {
    mockDbQueryRaw.mockResolvedValue([{ count: BigInt(3) }])
    const res = await GET()
    expect((res as any)._data.count).toBe(3)
    expect(typeof (res as any)._data.count).toBe('number')
  })

  it('should return count=0 when there are no unread conversations', async () => {
    mockDbQueryRaw.mockResolvedValue([{ count: BigInt(0) }])
    const res = await GET()
    expect((res as any)._data.count).toBe(0)
  })

  it('should return the correct count when there are multiple unread conversations', async () => {
    mockDbQueryRaw.mockResolvedValue([{ count: BigInt(12) }])
    const res = await GET()
    expect((res as any)._data.count).toBe(12)
  })

  it('should call $queryRaw once per request', async () => {
    await GET()
    expect(mockDbQueryRaw).toHaveBeenCalledOnce()
  })
})
