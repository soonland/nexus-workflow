import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/db/client'
import { auth } from '@/auth'
import { canAccess } from '@/lib/access'
import { createAuditLog } from '@/lib/audit'

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  legalName: z.string().max(200).optional().nullable(),
  industry: z.string().max(100).optional().nullable(),
  taxId: z.string().max(100).optional().nullable(),
  registrationNo: z.string().max(100).optional().nullable(),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const org = await db.organization.findUnique({
    where: { id },
    include: { owner: { select: { id: true, fullName: true } } },
  })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(org)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const org = await db.organization.findUnique({
    where: { id },
    include: { owner: { select: { userId: true } } },
  })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const allowed = await canAccess(session, 'organizations', 'write', org.owner?.userId ?? null, db)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const updated = await db.organization.update({
    where: { id },
    data: parsed.data,
    include: { owner: { select: { id: true, fullName: true } } },
  })

  await createAuditLog({
    db,
    entityType: 'Organization',
    entityId: id,
    action: 'UPDATE',
    actorId: session.user.id,
    actorName: session.user.email ?? session.user.id,
    before: { name: org.name, legalName: org.legalName, industry: org.industry, taxId: org.taxId, registrationNo: org.registrationNo } as Record<string, unknown>,
    after: parsed.data as Record<string, unknown>,
  })

  return NextResponse.json(updated)
}

export async function DELETE() {
  return NextResponse.json({ error: 'Method Not Allowed. Use POST /archive to soft-delete.' }, { status: 405 })
}
