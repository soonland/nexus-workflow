import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { db } from '@/db/client'
import { canEditContact } from '@/lib/orgAccess'
import { createAuditLog } from '@/lib/audit'

const patchSchema = z.object({
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().max(50).optional().nullable(),
  website: z.string().max(200).optional().nullable(),
  street: z.string().max(200).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
  postalCode: z.string().max(20).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const existing = await db.organization.findUnique({
    where: { id },
    select: { ownerId: true, email: true, phone: true, website: true, street: true, city: true, state: true, postalCode: true, country: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!canEditContact(session, existing.ownerId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  // Normalize empty strings to null
  const data: Record<string, string | null | undefined> = {}
  for (const [k, v] of Object.entries(parsed.data)) {
    data[k] = v === '' ? null : v
  }

  const org = await db.organization.update({
    where: { id },
    data,
    include: { owner: { select: { id: true, fullName: true } } },
  })

  const { ownerId: _ownerId, ...beforeContact } = existing
  await createAuditLog({
    db,
    entityType: 'Organization',
    entityId: id,
    action: 'UPDATE',
    actorId: session.user.id,
    actorName: session.user.email ?? session.user.id,
    before: beforeContact as Record<string, unknown>,
    after: data as Record<string, unknown>,
  })

  return NextResponse.json(org)
}
