import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/db/client'

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? ''

const bodySchema = z.object({
  status: z.enum(['active', 'inactive', 'archived']).optional(),
  statusChangeReason: z.string().nullable().optional(),
  workflowInstanceId: z.string().nullable().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token || token !== INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const body = await req.json()
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const existing = await db.organization.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const updateData: Record<string, unknown> = {}
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status
  if ('statusChangeReason' in parsed.data) updateData.statusChangeReason = parsed.data.statusChangeReason
  if ('workflowInstanceId' in parsed.data) updateData.workflowInstanceId = parsed.data.workflowInstanceId

  const org = await db.organization.update({
    where: { id },
    data: updateData,
  })

  return NextResponse.json(org)
}
