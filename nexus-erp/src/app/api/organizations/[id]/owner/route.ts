import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { db } from '@/db/client'
import { createAuditLog } from '@/lib/audit'

const patchSchema = z.object({
  ownerId: z.string().nullable(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const existing = await db.organization.findUnique({ where: { id }, select: { id: true, ownerId: true } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const org = await db.organization.update({
    where: { id },
    data: { ownerId: parsed.data.ownerId },
    include: { owner: { select: { id: true, fullName: true } } },
  })

  await createAuditLog({
    db,
    entityType: 'Organization',
    entityId: id,
    action: 'UPDATE',
    actorId: session.user.id,
    actorName: session.user.email ?? session.user.id,
    before: { ownerId: existing.ownerId },
    after: { ownerId: parsed.data.ownerId },
  })

  return NextResponse.json(org)
}
