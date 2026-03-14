import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/db/client'
import { auth } from '@/auth'
import { startInstance } from '@/lib/workflow'

const bodySchema = z.object({
  requestedStatus: z.enum(['active', 'inactive']),
  statusChangeReason: z.string().min(1).max(1000),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user.employeeId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const org = await db.organization.findUnique({
    where: { id },
    include: { owner: { select: { id: true, userId: true } } },
  })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Only the account owner can request a status change
  if (org.ownerId !== session.user.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Prevent duplicate in-flight requests
  if (org.workflowInstanceId) {
    return NextResponse.json({ error: 'A status change request is already in progress' }, { status: 409 })
  }

  const body = await req.json()
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const { requestedStatus, statusChangeReason } = parsed.data

  if (requestedStatus === org.status) {
    return NextResponse.json({ error: 'Requested status is the same as current status' }, { status: 422 })
  }

  const instance = await startInstance(
    'org-status-change',
    {
      organizationId: id,
      requestedStatus,
      statusChangeReason,
      requestedByUserId: session.user.id,
    },
    `org-status-${id}-${Date.now()}`,
  )

  await db.organization.update({
    where: { id },
    data: {
      statusChangeReason,
      workflowInstanceId: instance.id,
    },
  })

  return NextResponse.json({ workflowInstanceId: instance.id })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user.employeeId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const org = await db.organization.findUnique({
    where: { id },
    select: { id: true, ownerId: true, workflowInstanceId: true },
  })
  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (org.ownerId !== session.user.employeeId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!org.workflowInstanceId) {
    return NextResponse.json({ error: 'No pending request to cancel' }, { status: 409 })
  }

  // Cancel the workflow instance
  const { cancelInstance } = await import('@/lib/workflow')
  try {
    await cancelInstance(org.workflowInstanceId)
  } catch {
    // Instance may have already completed — still clear local state
  }

  await db.organization.update({
    where: { id },
    data: { workflowInstanceId: null, statusChangeReason: null },
  })

  return NextResponse.json({ cancelled: true })
}
