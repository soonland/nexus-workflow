import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { db } from '@/db/client'

const putSchema = z.object({
  groupIds: z.array(z.string()),
})

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const body = await req.json()
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const { groupIds } = parsed.data

  const targetUser = await db.user.findUnique({ where: { id }, select: { id: true } })
  if (!targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  await db.$transaction([
    db.groupMembership.deleteMany({ where: { userId: id } }),
    ...(groupIds.length > 0
      ? [db.groupMembership.createMany({
          data: groupIds.map((groupId) => ({ userId: id, groupId })),
        })]
      : []),
  ])

  return NextResponse.json({ groupIds })
}
