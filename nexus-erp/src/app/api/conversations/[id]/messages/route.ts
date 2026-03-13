import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/db/client'

const PAGE_SIZE = 30

// GET /api/conversations/[id]/messages?page=1
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const userId = session.user.id

  // Verify the user is a participant
  const participant = await db.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId: id, userId } },
  })
  if (!participant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(_req.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))

  const [total, messages] = await Promise.all([
    db.message.count({ where: { conversationId: id } }),
    db.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        sender: {
          select: {
            id: true,
            email: true,
            employee: { select: { fullName: true } },
          },
        },
      },
    }),
  ])

  // Find the last message read by the OTHER participant (for "Seen" receipt)
  const otherParticipant = await db.conversationParticipant.findFirst({
    where: { conversationId: id, userId: { not: userId } },
  })

  return NextResponse.json({
    messages: messages.map((m) => ({
      id: m.id,
      body: m.body,
      createdAt: m.createdAt,
      sender: {
        id: m.sender.id,
        name: m.sender.employee?.fullName ?? m.sender.email,
      },
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    otherLastReadAt: otherParticipant?.lastReadAt ?? null,
  })
}

// POST /api/conversations/[id]/messages — send a message
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const userId = session.user.id

  // Verify participant
  const participant = await db.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId: id, userId } },
  })
  if (!participant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { body } = await req.json() as { body: string }
  if (!body?.trim()) return NextResponse.json({ error: 'body required' }, { status: 400 })

  const message = await db.message.create({
    data: { conversationId: id, senderId: userId, body: body.trim() },
    include: {
      sender: {
        select: {
          id: true,
          email: true,
          employee: { select: { fullName: true } },
        },
      },
    },
  })

  // Mark conversation as read for sender
  await db.conversationParticipant.update({
    where: { conversationId_userId: { conversationId: id, userId } },
    data: { lastReadAt: message.createdAt },
  })

  return NextResponse.json({
    id: message.id,
    body: message.body,
    createdAt: message.createdAt,
    sender: {
      id: message.sender.id,
      name: message.sender.employee?.fullName ?? message.sender.email,
    },
  }, { status: 201 })
}
