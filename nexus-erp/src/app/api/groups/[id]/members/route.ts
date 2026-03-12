import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/db/client'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const { userIds = [] } = body as { userIds: string[] }

  await db.$transaction(async (tx) => {
    await tx.groupMembership.deleteMany({ where: { groupId: id } })
    if (userIds.length > 0) {
      await tx.groupMembership.createMany({
        data: userIds.map((userId) => ({ groupId: id, userId })),
      })
    }
  })

  return NextResponse.json({ ok: true })
}
