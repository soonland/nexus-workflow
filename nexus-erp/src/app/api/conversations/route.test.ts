import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockAuth,
  mockDbConversationParticipantFindMany,
  mockDbUserFindUnique,
  mockDbQueryRaw,
  mockDbConversationCreate,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockDbConversationParticipantFindMany: vi.fn(),
  mockDbUserFindUnique: vi.fn(),
  mockDbQueryRaw: vi.fn(),
  mockDbConversationCreate: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('@/db/client', () => ({
  db: {
    conversationParticipant: {
      findMany: mockDbConversationParticipantFindMany,
    },
    user: {
      findUnique: mockDbUserFindUnique,
    },
    $queryRaw: mockDbQueryRaw,
    conversation: {
      create: mockDbConversationCreate,
    },
  },
}))

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

import { GET, POST } from './route'

// ── Helpers ────────────────────────────────────────────────────────────────────

const NOW = new Date('2024-06-01T12:00:00Z')
const EARLIER = new Date('2024-06-01T10:00:00Z')

function makePostRequest(body: unknown) {
  return new Request('http://localhost/api/conversations', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const SESSION_USER = { id: 'user-1', role: 'employee' }

/** A single participation record returned by conversationParticipant.findMany */
function makeParticipation({
  convId = 'conv-1',
  otherUserId = 'user-2',
  lastReadAt = null as Date | null,
  lastMsgSenderId = 'user-2',
  lastMsgCreatedAt = NOW,
  includeMessage = true,
  timesheetId = null as string | null,
} = {}) {
  return {
    userId: SESSION_USER.id,
    lastReadAt,
    conversation: {
      id: convId,
      createdAt: EARLIER,
      timesheet: timesheetId ? { id: 'ts-1', weekStart: new Date('2024-05-27') } : null,
      participants: [
        {
          userId: SESSION_USER.id,
          user: { id: SESSION_USER.id, email: 'me@example.com', employee: { fullName: 'Me' } },
        },
        {
          userId: otherUserId,
          user: { id: otherUserId, email: 'other@example.com', employee: { fullName: 'Other User' } },
        },
      ],
      messages: includeMessage
        ? [{ id: 'msg-1', body: 'Hello', createdAt: lastMsgCreatedAt, senderId: lastMsgSenderId }]
        : [],
    },
  }
}

// ── GET tests ──────────────────────────────────────────────────────────────────

describe('GET /api/conversations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: SESSION_USER })
    mockDbConversationParticipantFindMany.mockResolvedValue([makeParticipation()])
  })

  it('should return 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET()
    expect((res as any)._status).toBe(401)
    expect((res as any)._data.error).toBe('Unauthorized')
  })

  it('should return 200 with an array on success', async () => {
    const res = await GET()
    expect((res as any)._status).toBe(200)
    expect(Array.isArray((res as any)._data)).toBe(true)
  })

  it('should return conversation with recipient info', async () => {
    const res = await GET()
    const [conv] = (res as any)._data
    expect(conv.id).toBe('conv-1')
    expect(conv.recipient).toEqual({
      id: 'user-2',
      name: 'Other User',
      email: 'other@example.com',
    })
  })

  it('should return null recipient when there is no other participant', async () => {
    mockDbConversationParticipantFindMany.mockResolvedValue([
      {
        userId: SESSION_USER.id,
        lastReadAt: null,
        conversation: {
          id: 'conv-solo',
          createdAt: EARLIER,
          timesheet: null,
          participants: [
            {
              userId: SESSION_USER.id,
              user: { id: SESSION_USER.id, email: 'me@example.com', employee: null },
            },
          ],
          messages: [],
        },
      },
    ])
    const res = await GET()
    const [conv] = (res as any)._data
    expect(conv.recipient).toBeNull()
  })

  it('should include lastMessage when a message exists', async () => {
    const res = await GET()
    const [conv] = (res as any)._data
    expect(conv.lastMessage).toEqual({
      body: 'Hello',
      createdAt: NOW,
      senderId: 'user-2',
    })
  })

  it('should return null lastMessage when conversation has no messages', async () => {
    mockDbConversationParticipantFindMany.mockResolvedValue([
      makeParticipation({ includeMessage: false }),
    ])
    const res = await GET()
    const [conv] = (res as any)._data
    expect(conv.lastMessage).toBeNull()
  })

  it('should set hasUnread=true when last message is from another user and lastReadAt is null', async () => {
    mockDbConversationParticipantFindMany.mockResolvedValue([
      makeParticipation({ lastReadAt: null, lastMsgSenderId: 'user-2' }),
    ])
    const res = await GET()
    const [conv] = (res as any)._data
    expect(conv.hasUnread).toBe(true)
  })

  it('should set hasUnread=false when last message was sent by the current user', async () => {
    mockDbConversationParticipantFindMany.mockResolvedValue([
      makeParticipation({ lastMsgSenderId: SESSION_USER.id }),
    ])
    const res = await GET()
    const [conv] = (res as any)._data
    expect(conv.hasUnread).toBe(false)
  })

  it('should set hasUnread=false when lastReadAt is after the last message', async () => {
    const readAfterMsg = new Date('2024-06-01T13:00:00Z')
    mockDbConversationParticipantFindMany.mockResolvedValue([
      makeParticipation({ lastReadAt: readAfterMsg, lastMsgSenderId: 'user-2', lastMsgCreatedAt: NOW }),
    ])
    const res = await GET()
    const [conv] = (res as any)._data
    expect(conv.hasUnread).toBe(false)
  })

  it('should set hasUnread=true when lastReadAt is before the last message', async () => {
    const readBeforeMsg = new Date('2024-06-01T09:00:00Z')
    mockDbConversationParticipantFindMany.mockResolvedValue([
      makeParticipation({ lastReadAt: readBeforeMsg, lastMsgSenderId: 'user-2', lastMsgCreatedAt: NOW }),
    ])
    const res = await GET()
    const [conv] = (res as any)._data
    expect(conv.hasUnread).toBe(true)
  })

  it('should include timesheet info when present', async () => {
    mockDbConversationParticipantFindMany.mockResolvedValue([
      makeParticipation({ timesheetId: 'ts-1' }),
    ])
    const res = await GET()
    const [conv] = (res as any)._data
    expect(conv.timesheet).toEqual({ id: 'ts-1', weekStart: new Date('2024-05-27') })
  })

  it('should return null timesheet when not linked to a timesheet', async () => {
    const res = await GET()
    const [conv] = (res as any)._data
    expect(conv.timesheet).toBeNull()
  })

  it('should sort conversations by latest message date descending', async () => {
    const older = makeParticipation({ convId: 'conv-old', lastMsgCreatedAt: EARLIER })
    const newer = makeParticipation({ convId: 'conv-new', lastMsgCreatedAt: NOW })
    // Provide in old-first order; expect sorted new-first
    mockDbConversationParticipantFindMany.mockResolvedValue([older, newer])
    const res = await GET()
    const ids = (res as any)._data.map((c: any) => c.id)
    expect(ids).toEqual(['conv-new', 'conv-old'])
  })

  it('should fall back to conversation.createdAt for sorting when there are no messages', async () => {
    const p1 = { ...makeParticipation({ convId: 'conv-a', includeMessage: false }) }
    const p2 = { ...makeParticipation({ convId: 'conv-b', includeMessage: false }) }
    p1.conversation = { ...p1.conversation, createdAt: EARLIER }
    p2.conversation = { ...p2.conversation, createdAt: NOW }
    mockDbConversationParticipantFindMany.mockResolvedValue([p1, p2])
    const res = await GET()
    const ids = (res as any)._data.map((c: any) => c.id)
    expect(ids).toEqual(['conv-b', 'conv-a'])
  })

  it('should use email as recipient name when employee record is absent', async () => {
    mockDbConversationParticipantFindMany.mockResolvedValue([
      {
        userId: SESSION_USER.id,
        lastReadAt: null,
        conversation: {
          id: 'conv-1',
          createdAt: EARLIER,
          timesheet: null,
          participants: [
            {
              userId: SESSION_USER.id,
              user: { id: SESSION_USER.id, email: 'me@example.com', employee: null },
            },
            {
              userId: 'user-2',
              user: { id: 'user-2', email: 'noname@example.com', employee: null },
            },
          ],
          messages: [],
        },
      },
    ])
    const res = await GET()
    const [conv] = (res as any)._data
    expect(conv.recipient?.name).toBe('noname@example.com')
  })

  it('should return an empty array when the user has no conversations', async () => {
    mockDbConversationParticipantFindMany.mockResolvedValue([])
    const res = await GET()
    expect((res as any)._data).toEqual([])
  })
})

// ── POST tests ─────────────────────────────────────────────────────────────────

describe('POST /api/conversations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: SESSION_USER })
    mockDbUserFindUnique.mockResolvedValue({ id: 'user-2' })
    mockDbQueryRaw.mockResolvedValue([])
    mockDbConversationCreate.mockResolvedValue({ id: 'conv-new' })
  })

  // ── Auth guards ──────────────────────────────────────────────────────────────

  it('should return 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST(makePostRequest({ recipientId: 'user-2' }))
    expect((res as any)._status).toBe(401)
    expect((res as any)._data.error).toBe('Unauthorized')
  })

  // ── Validation ────────────────────────────────────────────────────────────────

  it('should return 400 when recipientId is missing', async () => {
    const res = await POST(makePostRequest({}))
    expect((res as any)._status).toBe(400)
    expect((res as any)._data.error).toBe('recipientId required')
  })

  it('should return 400 when recipientId equals the current user id', async () => {
    const res = await POST(makePostRequest({ recipientId: SESSION_USER.id }))
    expect((res as any)._status).toBe(400)
    expect((res as any)._data.error).toBe('Cannot message yourself')
  })

  // ── Not found ────────────────────────────────────────────────────────────────

  it('should return 404 when the recipient does not exist', async () => {
    mockDbUserFindUnique.mockResolvedValue(null)
    const res = await POST(makePostRequest({ recipientId: 'user-2' }))
    expect((res as any)._status).toBe(404)
    expect((res as any)._data.error).toBe('Recipient not found')
  })

  // ── Existing conversation ─────────────────────────────────────────────────────

  it('should return the existing conversation id with created=false when a conversation already exists', async () => {
    mockDbQueryRaw.mockResolvedValue([{ id: 'conv-existing' }])
    const res = await POST(makePostRequest({ recipientId: 'user-2' }))
    expect((res as any)._status).toBe(200)
    expect((res as any)._data).toEqual({ id: 'conv-existing', created: false })
  })

  it('should not call db.conversation.create when a conversation already exists', async () => {
    mockDbQueryRaw.mockResolvedValue([{ id: 'conv-existing' }])
    await POST(makePostRequest({ recipientId: 'user-2' }))
    expect(mockDbConversationCreate).not.toHaveBeenCalled()
  })

  // ── Create new conversation ───────────────────────────────────────────────────

  it('should return 201 with created=true when a new conversation is created', async () => {
    const res = await POST(makePostRequest({ recipientId: 'user-2' }))
    expect((res as any)._status).toBe(201)
    expect((res as any)._data).toEqual({ id: 'conv-new', created: true })
  })

  it('should call db.conversation.create with both participant user ids', async () => {
    await POST(makePostRequest({ recipientId: 'user-2' }))
    expect(mockDbConversationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          participants: {
            create: expect.arrayContaining([
              { userId: SESSION_USER.id },
              { userId: 'user-2' },
            ]),
          },
        }),
      }),
    )
  })

  it('should include timesheetId in db.conversation.create when provided', async () => {
    await POST(makePostRequest({ recipientId: 'user-2', timesheetId: 'ts-42' }))
    expect(mockDbConversationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ timesheetId: 'ts-42' }),
      }),
    )
  })

  it('should set timesheetId to null in db.conversation.create when not provided', async () => {
    await POST(makePostRequest({ recipientId: 'user-2' }))
    expect(mockDbConversationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ timesheetId: null }),
      }),
    )
  })
})
