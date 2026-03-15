import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/db/client'
import { createAuditLog } from '@/lib/audit'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session || session.user.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const existing = await db.organization.findUnique({ where: { id }, select: { id: true, status: true } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const org = await db.organization.update({
    where: { id },
    data: { status: 'active' },
    include: { owner: { select: { id: true, fullName: true } } },
  })

  await createAuditLog({
    db,
    entityType: 'Organization',
    entityId: id,
    action: 'UPDATE',
    actorId: session.user.id,
    actorName: session.user.email ?? session.user.id,
    before: { status: existing.status },
    after: { status: 'active' },
  })

  return NextResponse.json(org)
}
