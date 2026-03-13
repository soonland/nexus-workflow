import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/db/client'

// POST /api/conversations/[id]/read — mark all messages in this conversation as read
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const userId = session.user.id

  const participant = await db.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId: id, userId } },
  })
  if (!participant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await db.conversationParticipant.update({
    where: { conversationId_userId: { conversationId: id, userId } },
    data: { lastReadAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
