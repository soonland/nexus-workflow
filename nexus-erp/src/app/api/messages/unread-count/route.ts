import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/db/client'

// GET /api/messages/unread-count — number of conversations with unread messages
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.user.id

  const [{ count }] = await db.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count
    FROM conversation_participants cp
    WHERE cp.user_id = ${userId}
    AND EXISTS (
      SELECT 1 FROM messages m
      WHERE m.conversation_id = cp.conversation_id
      AND m.sender_id != ${userId}
      AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
    )
  `

  return NextResponse.json({ count: Number(count) })
}
