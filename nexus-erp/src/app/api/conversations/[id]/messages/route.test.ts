import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockAuth,
  mockDbConversationParticipantFindUnique,
  mockDbConversationParticipantFindFirst,
  mockDbConversationParticipantUpdate,
  mockDbMessageCount,
  mockDbMessageFindMany,
  mockDbMessageCreate,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDbConversationParticipantFindUnique: vi.fn(),
  mockDbConversationParticipantFindFirst: vi.fn(),
  mockDbConversationParticipantUpdate: vi.fn(),
  mockDbMessageCount: vi.fn(),
  mockDbMessageFindMany: vi.fn(),
  mockDbMessageCreate: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/db/client', () => ({
  db: {
    conversationParticipant: {
      findUnique: mockDbConversationParticipantFindUnique,
      findFirst: mockDbConversationParticipantFindFirst,
      update: mockDbConversationParticipantUpdate,
    },
    message: {
      count: mockDbMessageCount,
      findMany: mockDbMessageFindMany,
      create: mockDbMessageCreate,
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

import { GET, POST } from './route'

// ── Helpers ────────────────────────────────────────────────────────────────────

const SESSION_USER = { id: 'user-1', role: 'employee' }
const CONV_ID = 'conv-123'
const NOW = new Date('2024-06-01T12:00:00Z')

function makeParams(id = CONV_ID) {
  return { params: Promise.resolve({ id }) }
}

function makeGetRequest(page?: number) {
  const url = `http://localhost/api/conversations/${CONV_ID}/messages${page ? `?page=${page}` : ''}`
  return new Request(url)
}

function makePostRequest(body: unknown) {
  return new Request(`http://localhost/api/conversations/${CONV_ID}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function makeMessage(overrides: Partial<{
  id: string
  body: string
  createdAt: Date
  senderId: string
  senderEmail: string
  senderFullName: string | null
}> = {}) {
  return {
    id: overrides.id ?? 'msg-1',
    body: overrides.body ?? 'Hello',
    createdAt: overrides.createdAt ?? NOW,
    senderId: overrides.senderId ?? 'user-2',
    sender: {
      id: overrides.senderId ?? 'user-2',
      email: overrides.senderEmail ?? 'other@example.com',
      employee: overrides.senderFullName !== undefined
        ? (overrides.senderFullName ? { fullName: overrides.senderFullName } : null)
        : { fullName: 'Other User' },
    },
  }
}

// ── GET tests ──────────────────────────────────────────────────────────────────

describe('GET /api/conversations/[id]/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: SESSION_USER })
    mockDbConversationParticipantFindUnique.mockResolvedValue({ userId: SESSION_USER.id, conversationId: CONV_ID })
    mockDbMessageCount.mockResolvedValue(2)
    mockDbMessageFindMany.mockResolvedValue([makeMessage()])
    mockDbConversationParticipantFindFirst.mockResolvedValue({ userId: 'user-2', lastReadAt: null })
  })

  it('should return 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeGetRequest(), makeParams())
    expect((res as any)._status).toBe(401)
    expect((res as any)._data.error).toBe('Unauthorized')
  })

  it('should return 403 when user is not a participant', async () => {
    mockDbConversationParticipantFindUnique.mockResolvedValue(null)
    const res = await GET(makeGetRequest(), makeParams())
    expect((res as any)._status).toBe(403)
    expect((res as any)._data.error).toBe('Forbidden')
  })

  it('should return 200 with messages array on success', async () => {
    const res = await GET(makeGetRequest(), makeParams())
    expect((res as any)._status).toBe(200)
    expect(Array.isArray((res as any)._data.messages)).toBe(true)
  })

  it('should return total count and page info', async () => {
    mockDbMessageCount.mockResolvedValue(45)
    const res = await GET(makeGetRequest(), makeParams())
    const data = (res as any)._data
    expect(data.total).toBe(45)
    expect(data.page).toBe(1)
    expect(data.pageSize).toBe(30)
  })

  it('should use the page query parameter for pagination', async () => {
    await GET(makeGetRequest(2), makeParams())
    expect(mockDbMessageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 30, take: 30 }),
    )
  })

  it('should clamp page to 1 when page is 0 or negative', async () => {
    const req = new Request(`http://localhost/api/conversations/${CONV_ID}/messages?page=0`)
    await GET(req, makeParams())
    expect(mockDbMessageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0 }),
    )
  })

  it('should default to page 1 when no page param is provided', async () => {
    await GET(makeGetRequest(), makeParams())
    expect(mockDbMessageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0 }),
    )
  })

  it('should map sender name from employee.fullName', async () => {
    const res = await GET(makeGetRequest(), makeParams())
    const [msg] = (res as any)._data.messages
    expect(msg.sender.name).toBe('Other User')
  })

  it('should fall back to sender email when employee record is absent', async () => {
    mockDbMessageFindMany.mockResolvedValue([makeMessage({ senderFullName: null })])
    const res = await GET(makeGetRequest(), makeParams())
    const [msg] = (res as any)._data.messages
    expect(msg.sender.name).toBe('other@example.com')
  })

  it('should include otherLastReadAt from the other participant', async () => {
    const readAt = new Date('2024-06-01T11:00:00Z')
    mockDbConversationParticipantFindFirst.mockResolvedValue({ userId: 'user-2', lastReadAt: readAt })
    const res = await GET(makeGetRequest(), makeParams())
    expect((res as any)._data.otherLastReadAt).toEqual(readAt)
  })

  it('should return null otherLastReadAt when the other participant has never read', async () => {
    mockDbConversationParticipantFindFirst.mockResolvedValue({ userId: 'user-2', lastReadAt: null })
    const res = await GET(makeGetRequest(), makeParams())
    expect((res as any)._data.otherLastReadAt).toBeNull()
  })

  it('should return null otherLastReadAt when there is no other participant', async () => {
    mockDbConversationParticipantFindFirst.mockResolvedValue(null)
    const res = await GET(makeGetRequest(), makeParams())
    expect((res as any)._data.otherLastReadAt).toBeNull()
  })
})

// ── POST tests ─────────────────────────────────────────────────────────────────

describe('POST /api/conversations/[id]/messages', () => {
  const CREATED_MSG = makeMessage({ id: 'msg-new', body: 'Hi there', senderId: SESSION_USER.id, senderEmail: 'me@example.com', senderFullName: 'Me' })

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: SESSION_USER })
    mockDbConversationParticipantFindUnique.mockResolvedValue({ userId: SESSION_USER.id, conversationId: CONV_ID })
    mockDbMessageCreate.mockResolvedValue({ ...CREATED_MSG, createdAt: NOW })
    mockDbConversationParticipantUpdate.mockResolvedValue({})
  })

  it('should return 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePostRequest({ body: 'Hi' }), makeParams())
    expect((res as any)._status).toBe(401)
    expect((res as any)._data.error).toBe('Unauthorized')
  })

  it('should return 403 when user is not a participant', async () => {
    mockDbConversationParticipantFindUnique.mockResolvedValue(null)
    const res = await POST(makePostRequest({ body: 'Hi' }), makeParams())
    expect((res as any)._status).toBe(403)
    expect((res as any)._data.error).toBe('Forbidden')
  })

  it('should return 400 when body is missing', async () => {
    const res = await POST(makePostRequest({}), makeParams())
    expect((res as any)._status).toBe(400)
    expect((res as any)._data.error).toBe('body required')
  })

  it('should return 400 when body is an empty string', async () => {
    const res = await POST(makePostRequest({ body: '' }), makeParams())
    expect((res as any)._status).toBe(400)
  })

  it('should return 400 when body is whitespace only', async () => {
    const res = await POST(makePostRequest({ body: '   ' }), makeParams())
    expect((res as any)._status).toBe(400)
  })

  it('should return 201 with the created message on success', async () => {
    const res = await POST(makePostRequest({ body: 'Hi there' }), makeParams())
    expect((res as any)._status).toBe(201)
    expect((res as any)._data.id).toBe('msg-new')
    expect((res as any)._data.body).toBe('Hi there')
  })

  it('should call db.message.create with trimmed body', async () => {
    await POST(makePostRequest({ body: '  Hi there  ' }), makeParams())
    expect(mockDbMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          body: 'Hi there',
          conversationId: CONV_ID,
          senderId: SESSION_USER.id,
        }),
      }),
    )
  })

  it('should update conversationParticipant.lastReadAt after sending', async () => {
    await POST(makePostRequest({ body: 'Hi' }), makeParams())
    expect(mockDbConversationParticipantUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId_userId: { conversationId: CONV_ID, userId: SESSION_USER.id } },
        data: { lastReadAt: NOW },
      }),
    )
  })

  it('should map sender name from employee.fullName in response', async () => {
    const res = await POST(makePostRequest({ body: 'Hi' }), makeParams())
    expect((res as any)._data.sender.name).toBe('Me')
  })

  it('should fall back to sender email when employee record is absent', async () => {
    mockDbMessageCreate.mockResolvedValue({
      ...CREATED_MSG,
      createdAt: NOW,
      sender: { id: SESSION_USER.id, email: 'me@example.com', employee: null },
    })
    const res = await POST(makePostRequest({ body: 'Hi' }), makeParams())
    expect((res as any)._data.sender.name).toBe('me@example.com')
  })
})
