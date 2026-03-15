import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/db/client'
import { createAuditLog } from '@/lib/audit'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const group = await db.group.findUnique({
    where: { id },
    include: {
      permissions: { select: { permissionKey: true } },
      members: {
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
    },
  })

  if (!group) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(group)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const { name, description, type } = body as { name?: string; description?: string; type?: 'security' | 'default' }

  const before = await db.group.findUnique({ where: { id }, select: { name: true, description: true, type: true } })

  const group = await db.group.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(description !== undefined ? { description: description?.trim() || null } : {}),
      ...(type !== undefined ? { type } : {}),
    },
  })

  await createAuditLog({
    db,
    entityType: 'Group',
    entityId: id,
    action: 'UPDATE',
    actorId: session.user.id,
    actorName: session.user.email ?? session.user.id,
    before: before as Record<string, unknown>,
    after: { name, description, type } as Record<string, unknown>,
  })

  return NextResponse.json(group)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const grp = await db.group.findUnique({ where: { id }, select: { name: true, type: true } })
  await db.group.delete({ where: { id } })

  await createAuditLog({
    db,
    entityType: 'Group',
    entityId: id,
    action: 'DELETE',
    actorId: session.user.id,
    actorName: session.user.email ?? session.user.id,
    before: { id, name: grp?.name, type: grp?.type } as Record<string, unknown>,
  })

  return new NextResponse(null, { status: 204 })
}
