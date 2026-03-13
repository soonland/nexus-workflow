import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/db/client'

// GET /api/conversations — list all conversations for the current user
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.user.id

  const participations = await db.conversationParticipant.findMany({
    where: { userId },
    include: {
      conversation: {
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  employee: { select: { fullName: true } },
                },
              },
            },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          timesheet: { select: { id: true, weekStart: true } },
        },
      },
    },
  })

  // Sort by latest message date (most recent first)
  participations.sort((a, b) => {
    const aTime = a.conversation.messages[0]?.createdAt.getTime() ?? a.conversation.createdAt.getTime()
    const bTime = b.conversation.messages[0]?.createdAt.getTime() ?? b.conversation.createdAt.getTime()
    return bTime - aTime
  })

  const result = participations.map((p) => {
    const other = p.conversation.participants.find((cp) => cp.userId !== userId)
    const lastMsg = p.conversation.messages[0]
    const lastReadAt = p.lastReadAt

    // Count unread: messages from others after lastReadAt
    // We compute this from the fetched data (last message only — approximate)
    const hasUnread =
      lastMsg &&
      lastMsg.senderId !== userId &&
      (lastReadAt === null || lastMsg.createdAt > lastReadAt)

    return {
      id: p.conversation.id,
      recipient: other
        ? {
            id: other.userId,
            name: other.user.employee?.fullName ?? other.user.email,
            email: other.user.email,
          }
        : null,
      lastMessage: lastMsg
        ? { body: lastMsg.body, createdAt: lastMsg.createdAt, senderId: lastMsg.senderId }
        : null,
      hasUnread: !!hasUnread,
      timesheet: p.conversation.timesheet
        ? { id: p.conversation.timesheet.id, weekStart: p.conversation.timesheet.weekStart }
        : null,
    }
  })

  return NextResponse.json(result)
}

// POST /api/conversations — find or create a 1-on-1 conversation
export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.user.id
  const { recipientId, timesheetId } = await req.json() as { recipientId: string; timesheetId?: string }

  if (!recipientId) return NextResponse.json({ error: 'recipientId required' }, { status: 400 })
  if (recipientId === userId) return NextResponse.json({ error: 'Cannot message yourself' }, { status: 400 })

  // Verify recipient exists
  const recipient = await db.user.findUnique({ where: { id: recipientId }, select: { id: true } })
  if (!recipient) return NextResponse.json({ error: 'Recipient not found' }, { status: 404 })

  // Find existing 1-on-1 conversation between these two users
  const [existing] = await db.$queryRaw<[{ id: string }?]>`
    SELECT c.id FROM conversations c
    JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = ${userId}
    JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = ${recipientId}
    WHERE (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = c.id) = 2
    LIMIT 1
  `

  if (existing) {
    return NextResponse.json({ id: existing.id, created: false })
  }

  // Create new conversation
  const conversation = await db.conversation.create({
    data: {
      timesheetId: timesheetId ?? null,
      participants: {
        create: [{ userId }, { userId: recipientId }],
      },
    },
  })

  return NextResponse.json({ id: conversation.id, created: true }, { status: 201 })
}
