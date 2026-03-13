import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/db/client'
import MessagesClient from './MessagesClient'

interface MessagesPageProps {
  searchParams: Promise<{ conversationId?: string; recipientId?: string; timesheetId?: string }>
}

const MessagesPage = async ({ searchParams }: MessagesPageProps) => {
  const session = await auth()
  if (!session) redirect('/login')

  const { conversationId, recipientId, timesheetId } = await searchParams
  const userId = session.user.id

  let resolvedConversationId = conversationId
  let resolvedRecipientId = recipientId

  // Resolve timesheetId → recipientId + link conversation to timesheet
  if (timesheetId && !conversationId && !recipientId) {
    const ts = await db.timesheet.findUnique({
      where: { id: timesheetId },
      select: {
        employeeId: true,
        employee: {
          select: {
            userId: true,
            manager: { select: { userId: true } },
          },
        },
      },
    })

    if (ts) {
      const empUserId = ts.employee.userId
      const mgrUserId = ts.employee.manager?.userId

      // If viewer is the employee → message the manager; otherwise → message the employee
      const otherUserId = empUserId === userId ? mgrUserId : empUserId

      if (otherUserId && otherUserId !== userId) {
        resolvedRecipientId = otherUserId

        // Find or create conversation linked to this timesheet
        const [existing] = await db.$queryRaw<[{ id: string }?]>`
          SELECT c.id FROM conversations c
          JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = ${userId}
          JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = ${otherUserId}
          WHERE (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = c.id) = 2
          LIMIT 1
        `

        if (existing) {
          resolvedConversationId = existing.id
          resolvedRecipientId = undefined
        } else {
          const conv = await db.conversation.create({
            data: {
              timesheetId,
              participants: { create: [{ userId }, { userId: otherUserId }] },
            },
          })
          resolvedConversationId = conv.id
          resolvedRecipientId = undefined
        }
      }
    }
  }

  // Resolve recipientId → find or create conversation (no timesheet link)
  if (resolvedRecipientId && !resolvedConversationId) {
    const recipient = await db.user.findUnique({ where: { id: resolvedRecipientId }, select: { id: true } })
    if (recipient && recipient.id !== userId) {
      const [existing] = await db.$queryRaw<[{ id: string }?]>`
        SELECT c.id FROM conversations c
        JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = ${userId}
        JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = ${resolvedRecipientId}
        WHERE (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = c.id) = 2
        LIMIT 1
      `

      if (existing) {
        resolvedConversationId = existing.id
        resolvedRecipientId = undefined
      } else {
        const conv = await db.conversation.create({
          data: {
            participants: { create: [{ userId }, { userId: resolvedRecipientId }] },
          },
        })
        resolvedConversationId = conv.id
        resolvedRecipientId = undefined
      }
    }
  }

  return (
    <MessagesClient
      userId={userId}
      initialConversationId={resolvedConversationId}
    />
  )
}
export default MessagesPage
