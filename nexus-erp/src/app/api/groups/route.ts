import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/db/client'
import { createAuditLog } from '@/lib/audit'

export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const groups = await db.group.findMany({
    include: { _count: { select: { permissions: true, members: true } } },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(groups)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session || session.user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { name, description, type = 'security', permissionKeys = [], memberUserIds = [] } = body as {
    name: string
    description?: string
    type?: 'security' | 'default'
    permissionKeys?: string[]
    memberUserIds?: string[]
  }

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const group = await db.$transaction(async (tx) => {
    const created = await tx.group.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        type,
      },
    })

    if (permissionKeys.length > 0) {
      await tx.groupPermission.createMany({
        data: permissionKeys.map((key) => ({ groupId: created.id, permissionKey: key })),
      })
    }

    if (memberUserIds.length > 0) {
      await tx.groupMembership.createMany({
        data: memberUserIds.map((userId) => ({ groupId: created.id, userId })),
      })
    }

    return created
  })

  await createAuditLog({
    db,
    entityType: 'Group',
    entityId: group.id,
    action: 'CREATE',
    actorId: session.user.id,
    actorName: session.user.email ?? session.user.id,
    after: { id: group.id, name: group.name, type: group.type },
  })

  return NextResponse.json(group, { status: 201 })
}
