import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockAuth,
  mockDbConversationParticipantFindUnique,
  mockDbConversationParticipantUpdate,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDbConversationParticipantFindUnique: vi.fn(),
  mockDbConversationParticipantUpdate: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/db/client', () => ({
  db: {
    conversationParticipant: {
      findUnique: mockDbConversationParticipantFindUnique,
      update: mockDbConversationParticipantUpdate,
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

import { POST } from './route'

// ── Helpers ────────────────────────────────────────────────────────────────────

const SESSION_USER = { id: 'user-1', role: 'employee' }
const CONV_ID = 'conv-123'

function makeRequest() {
  return new Request(`http://localhost/api/conversations/${CONV_ID}/read`, { method: 'POST' })
}

function makeParams(id = CONV_ID) {
  return { params: Promise.resolve({ id }) }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('POST /api/conversations/[id]/read', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: SESSION_USER })
    mockDbConversationParticipantFindUnique.mockResolvedValue({
      userId: SESSION_USER.id,
      conversationId: CONV_ID,
    })
    mockDbConversationParticipantUpdate.mockResolvedValue({})
  })

  // ── Auth guards ──────────────────────────────────────────────────────────────

  it('should return 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makeRequest(), makeParams())
    expect((res as any)._status).toBe(401)
    expect((res as any)._data.error).toBe('Unauthorized')
  })

  // ── Authorization ────────────────────────────────────────────────────────────

  it('should return 403 when user is not a participant in the conversation', async () => {
    mockDbConversationParticipantFindUnique.mockResolvedValue(null)
    const res = await POST(makeRequest(), makeParams())
    expect((res as any)._status).toBe(403)
    expect((res as any)._data.error).toBe('Forbidden')
  })

  // ── Success ──────────────────────────────────────────────────────────────────

  it('should return 200 with { ok: true } on success', async () => {
    const res = await POST(makeRequest(), makeParams())
    expect((res as any)._status).toBe(200)
    expect((res as any)._data).toEqual({ ok: true })
  })

  it('should verify participation using the correct composite key', async () => {
    await POST(makeRequest(), makeParams())
    expect(mockDbConversationParticipantFindUnique).toHaveBeenCalledWith({
      where: {
        conversationId_userId: {
          conversationId: CONV_ID,
          userId: SESSION_USER.id,
        },
      },
    })
  })

  it('should call db.conversationParticipant.update with lastReadAt set to a date', async () => {
    await POST(makeRequest(), makeParams())
    expect(mockDbConversationParticipantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversationId_userId: {
            conversationId: CONV_ID,
            userId: SESSION_USER.id,
          },
        },
        data: { lastReadAt: expect.any(Date) },
      }),
    )
  })

  it('should not call db.conversationParticipant.update when the user is not a participant', async () => {
    mockDbConversationParticipantFindUnique.mockResolvedValue(null)
    await POST(makeRequest(), makeParams())
    expect(mockDbConversationParticipantUpdate).not.toHaveBeenCalled()
  })

  it('should use the conversation id from route params', async () => {
    await POST(makeRequest(), makeParams('conv-abc'))
    expect(mockDbConversationParticipantFindUnique).toHaveBeenCalledWith({
      where: {
        conversationId_userId: {
          conversationId: 'conv-abc',
          userId: SESSION_USER.id,
        },
      },
    })
  })
})
